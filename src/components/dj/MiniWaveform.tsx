import { useEffect, useRef } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'

interface MiniWaveformProps {
  deck: DeckEngine
  waveColor: string
  className?: string
}

export function MiniWaveform({ deck, waveColor, className = '' }: MiniWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDragging = useRef(false)

  const seekFromEvent = (e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || !deck.track) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const ratio = x / rect.width
    deck.seek(ratio * deck.duration)
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!deck.track) return
    isDragging.current = true
    seekFromEvent(e)

    const onMouseMove = (ev: MouseEvent) => {
      if (isDragging.current) seekFromEvent(ev)
    }
    const onMouseUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

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

      const track = deck.track
      if (!track || !track.peaks || track.peaks.length === 0) {
        // Flat line when empty
        ctx.strokeStyle = '#282828'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, h / 2)
        ctx.lineTo(w, h / 2)
        ctx.stroke()
        return
      }

      const peaks = track.peaks
      const posRatio = deck.duration > 0 ? deck.position / deck.duration : 0
      const mid = h / 2

      // Draw peaks
      const step = peaks.length / w
      for (let x = 0; x < w; x++) {
        const peakIdx = Math.floor(x * step)
        const amp = Math.max((peaks[peakIdx] ?? 0) * (mid - 2), 0.5)
        const isPlayed = x / w <= posRatio

        ctx.fillStyle = isPlayed ? waveColor : '#444444'
        ctx.fillRect(x, mid - amp, 1, amp * 2)
      }

      // Draw Cue 'C' flag
      if (deck.duration > 0 && deck.cuePoint > 0) {
        const cueX = (deck.cuePoint / deck.duration) * w
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(cueX - 1, 0, 2, h)

        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 9px Inter, ui-sans-serif, sans-serif'
        ctx.fillText('C', cueX + 2, 8)
      }

      // Draw current Playhead indicator needle
      const playheadX = posRatio * w
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = 4
      ctx.fillRect(playheadX - 1, 0, 2, h)
      ctx.shadowBlur = 0
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deck, waveColor])

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      className={`h-6 w-full cursor-pointer select-none rounded bg-[#161616] border border-[#282828] ${className}`}
      title="Click or drag to seek in track"
    />
  )
}
