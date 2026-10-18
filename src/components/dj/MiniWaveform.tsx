import { useEffect, useRef } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { canvasPixelRatio } from '@/lib/canvas-dpr'
import { consoleProfile } from '@/lib/dj/device-profile'
import { cueFlag } from '@/lib/dj/cue-flag'

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
    let drawn = 0
    let rect = { width: 0, height: 0 }
    // There is one of these per deck and its whole width is redrawn each frame, so it takes the
    // same hand-held stride as the lanes. The cadence is counted in drawn frames, so a stride
    // of two cannot skip the frame that measures the box.
    const stride = consoleProfile().canvasStride
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (drawn++ % stride !== 0) return
      // A layout read, not a paint: the box only changes when the viewport does, and the
      // chassis this canvas sits in is scaled by a transform, so the measured width is
      // re-read once every eight drawn frames (a few times a second) rather than sixty times a
      // second — time a phone would rather spend on the audio thread.
      if (rect.width === 0 || drawn % 8 === 0) rect = canvas.getBoundingClientRect()
      if (rect.width === 0) return
      const dpr = canvasPixelRatio()
      const w = rect.width
      const h = rect.height

      // Size the store in whole device pixels and compare against *those*. `canvas.width`
      // truncates whatever it is assigned, so comparing it with a fractional target — a
      // fractional CSS width or devicePixelRatio, i.e. most Chrome/Edge zoom levels — is never
      // equal, and the canvas would be re-created, and blanked, on every single animation frame.
      // Chromium renders a canvas it cannot hold a surface for as an opaque white box with its
      // broken-content glyph, which is exactly what appeared at the deck headers while zooming;
      // Firefox keeps the previous surface, which is why it never showed there.
      const bw = Math.max(1, Math.round(w * dpr))
      const bh = Math.max(1, Math.round(h * dpr))
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      // Scale from the store we actually got, so drawing in CSS pixels fills it exactly —
      // scaling by the raw dpr would leave a half-pixel of the rounded store unpainted.
      ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0)
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
      //
      // Two paths rather than two `fillRect`s per column. This strip is only a couple of hundred
      // columns wide, so it is the cheaper of the two waveform surfaces, but it is redrawn twice
      // as often as the lanes are (once per deck) and paid the same per-column `fillStyle`
      // change. Filling a path is the same picture with four canvas calls.
      const step = peaks.length / w
      const playedColumns = Math.min(w, Math.max(0, Math.floor(posRatio * w) + 1))
      const columnPath = (from: number, to: number) => {
        ctx.beginPath()
        for (let x = from; x < to; x++) {
          const peakIdx = Math.floor(x * step)
          const amp = Math.max((peaks[peakIdx] ?? 0) * (mid - 2), 0.5)
          ctx.rect(x, mid - amp, 1, amp * 2)
        }
        ctx.fill()
      }

      ctx.fillStyle = '#444444'
      columnPath(playedColumns, w)
      ctx.fillStyle = waveColor
      columnPath(0, playedColumns)

      // Cue flags — the CUE point's 'C' and the numbered hot cues, drawn as the same white
      // stripe the full-width lanes use. This strip spans the whole track rather than a scroll
      // window, so a cue stays on screen as a fixed landmark while mixing instead of only while
      // the lane happens to be showing that part of the track.
      //
      // Sized from the strip: `h` is the *displayed* height, ~15 px on a phone against 22 at
      // the design size, so the label has to come down with it — see `cueFlag`.
      if (deck.duration > 0) {
        const flag = cueFlag(h)
        const stripe = (seconds: number, label: string) => {
          const x = (seconds / deck.duration) * w
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(x - flag.stripe / 2, 0, flag.stripe, h)
          ctx.fillStyle = '#ffffff'
          ctx.font = `bold ${flag.font}px Inter, ui-sans-serif, sans-serif`
          ctx.fillText(label, x + 2, flag.baseline)
        }

        deck.hotCues.forEach((cue, i) => {
          if (cue === null) return
          stripe(cue, `${i + 1}`)
        })
        if (deck.cuePoint > 0) stripe(deck.cuePoint, 'C')
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
    <div
      className={`relative flex items-center h-6 w-full rounded bg-[#161616] border border-[#282828] overflow-hidden ${className}`}
    >
      {/* Skip backwards to start button matching mockup */}
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          deck.seek(0)
        }}
        disabled={!deck.track}
        className="h-full px-1.5 flex items-center justify-center bg-[#181818] hover:bg-[#252525] active:bg-[#333333] text-[#888888] hover:text-white border-r border-[#282828] transition-colors shrink-0 disabled:opacity-30 disabled:pointer-events-none"
        title="Skip to start of track (|◀)"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className="w-2.5 h-2.5"
          aria-hidden="true"
        >
          <path d="M2 3a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zm11.196 1.402A1 1 0 0 0 11.667 4L5.333 7.333a1 1 0 0 0 0 1.334l6.334 3.333A1 1 0 0 0 13.196 11.4V4.602a1 1 0 0 0 0-.2z" />
        </svg>
      </button>

      {/*
        Waveform Canvas. It is positioned inside a flex-1 box rather than being the flex item
        itself, because a canvas is a replaced element and a flex item's automatic minimum size is
        its own width/height *attributes* — which this draw loop sets from the measured CSS width.
        Left as a flex item, that closes a loop: the attribute becomes the minimum width, the
        wider element measures wider next frame, and the canvas multiplies by the device pixel
        ratio every frame until it passes Chromium's maximum canvas size, where Chromium paints it
        as an opaque white box with its broken-content glyph instead of drawing. Firefox keeps
        whatever it last put in the canvas, which is why only Chrome and Edge showed it.
      */}
      <div className="relative h-full min-w-0 flex-1">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          className="absolute inset-0 h-full w-full cursor-pointer select-none"
          title="Click or drag to seek in track"
        />
      </div>
    </div>
  )
}
