import { useEffect, useMemo, useRef, useState } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { computePeaks } from '@/lib/dj/peaks'
import {
  beatIndexAt,
  downbeatIndex,
  dropMarkers,
  isVariableGrid,
  localTempoRange,
  phraseBoundaries,
} from '@/lib/dj/grid'
import { laneSecPerPx, laneTimebase, laneX } from '@/lib/dj/waveform-timebase'
import type { Track } from '@/lib/dj/types'

interface StackedWaveformsProps {
  deckA: DeckEngine
  deckB: DeckEngine
  className?: string
  onDropFile?: (deckId: 'A' | 'B', file: File) => void
  onLoadClick?: (deckId: 'A' | 'B') => void
}

const zoomPeaksCache = new WeakMap<Track, Float32Array>()
const ZOOM_PPS = 140

/**
 * Section-marker colours.
 *
 * Amber for a drop and a faint grey for a measured phrase boundary: colour is
 * doing one job here, saying which lines are structural, and neither of them is
 * allowed to compete with the beat grid's own white downbeat stripes.
 */
const MARKER_DROP = '#f59e0b'
const MARKER_PHRASE = '#9ca3af'

/**
 * The white of the beat grid's downbeat stripes, as drawn by the waveform canvas.
 *
 * Held here rather than written twice: the Set-Downbeat button tints its marker with this same
 * value, so the icon and the line it sets are the same colour by construction instead of two
 * whites that merely look alike.
 */
const DOWNBEAT_STRIPE = '#f4f4f5'

/**
 * Visible span of the waveform, in playback seconds.
 *
 * One step per button press *and* per wheel notch, so the − / + pill and the mouse
 * wheel are two ways of working the same control rather than two similar controls.
 */
const WINDOW_MIN_S = 3
const WINDOW_MAX_S = 18
const WINDOW_STEP_S = 2

/** Clamp-and-step for the zoom window. `dir` is −1 to zoom in, +1 to zoom out. */
function stepWindowSeconds(current: number, dir: -1 | 1): number {
  return Math.min(WINDOW_MAX_S, Math.max(WINDOW_MIN_S, current + dir * WINDOW_STEP_S))
}

function getZoomPeaks(track: Track): Float32Array {
  let peaks = zoomPeaksCache.get(track)
  if (!peaks) {
    peaks = computePeaks(track.buffer, Math.ceil(track.duration * ZOOM_PPS))
    zoomPeaksCache.set(track, peaks)
  }
  return peaks
}

export function StackedWaveforms({
  deckA,
  deckB,
  className = '',
  onDropFile,
  onLoadClick,
}: StackedWaveformsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [windowSeconds, setWindowSeconds] = useState(8)
  const [dragOverDeck, setDragOverDeck] = useState<'A' | 'B' | null>(null)

  const dragRef = useRef<{
    deck: DeckEngine
    startX: number
    startPos: number
    lastX: number
    lastTime: number
    velocity: number
    raf: number
  } | null>(null)

  const [activeGridDeckId, setActiveGridDeckId] = useState<'A' | 'B' | null>(null)
  const activeGridDeck = activeGridDeckId === 'A' ? deckA : deckB
  const activeGrid = activeGridDeck.track?.grid ?? null

  // Tempo spread of a drifting grid, so the VAR badge can show how far the track
  // wanders instead of a single misleading average. Smoothed, because one measured
  // interval is only as precise as the detector's tick resolution.
  const driftLabel = useMemo(() => {
    if (!activeGrid || !isVariableGrid(activeGrid)) return ''
    const range = localTempoRange(activeGrid)
    return range ? `${range.min.toFixed(1)}-${range.max.toFixed(1)} BPM` : 'measured beats'
  }, [activeGrid])

  const zoomIn = () => setWindowSeconds(s => stepWindowSeconds(s, -1))
  const zoomOut = () => setWindowSeconds(s => stepWindowSeconds(s, 1))

  // Wheel over the waveform zooms exactly like the − / + buttons: one notch, one step, so
  // the two controls stay interchangeable and a user can count either one.
  //
  // Registered natively rather than through React's `onWheel` because React attaches
  // `wheel` at the root as a *passive* listener, where preventDefault() is ignored — the
  // page behind the waveform would scroll while the waveform zoomed.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      setWindowSeconds(s => stepWindowSeconds(s, e.deltaY < 0 ? -1 : 1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.height === 0) return
    const y = e.clientY - rect.top
    const isDeckA = y < rect.height / 2
    const target = isDeckA ? 'A' : 'B'
    if (dragOverDeck !== target) {
      setDragOverDeck(target)
    }
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverDeck(null)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const target = y < rect.height / 2 ? 'A' : 'B'
    setDragOverDeck(null)

    const files = e.dataTransfer.files
    if (files && files.length > 0 && onDropFile) {
      onDropFile(target, files[0])
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
    if (!activeDeck.track) {
      onLoadClick?.(isDeckA ? 'A' : 'B')
      return
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    canvas.style.cursor = 'grabbing'

    // Seek-only scrub (do not also scratch — dual seek+scratch fights position each frame).
    dragRef.current = {
      deck: activeDeck,
      startX: e.clientX,
      startPos: activeDeck.position,
      lastX: e.clientX,
      lastTime: performance.now(),
      velocity: 0,
      raf: 0,
    }
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
    // Source seconds per pixel, matching the lane's own axis. Without the rate term a
    // drag would scrub faster or slower than the waveform moves under it.
    const secPerPx = laneSecPerPx(windowSeconds / w, s.deck.rate)

    s.lastX = e.clientX
    s.lastTime = performance.now()

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

      // Whole device pixels, compared against the store we set rather than the fractional
      // target: `canvas.width` truncates, so `width !== w * dpr` is permanently true whenever
      // the product is fractional — which is most Chrome/Edge zoom levels. That re-created and
      // blanked this canvas on every frame, and Chromium paints a canvas it has no surface for
      // as an opaque white box. Rounding means a resize only happens when the size really moves.
      const bw = Math.max(1, Math.round(w * dpr))
      const bh = Math.max(1, Math.round(h * dpr))
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      // Scale from the store we actually got, so CSS-pixel drawing fills it exactly.
      ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const halfH = h / 2
      const secPerPx = windowSeconds / w
      const centerPlayheadX = w / 2

      // Render Deck A (Top Half, Green)
      renderDeckLane({
        ctx,
        deck: deckA,
        deckLetter: 'A',
        topY: 0,
        laneH: halfH,
        windowSeconds,
        secPerPx,
        waveColor: '#34d399',
        beatColor: '#a1a1aa',
        downbeatColor: DOWNBEAT_STRIPE,
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
        deckLetter: 'B',
        topY: halfH,
        laneH: halfH,
        windowSeconds,
        secPerPx,
        waveColor: '#a855f7',
        beatColor: '#a1a1aa',
        downbeatColor: DOWNBEAT_STRIPE,
      })

      // Virtual FLUX Mode Playhead Needles (Green). The offset is measured from the same
      // position the lane is centred on — `audiblePosition`, not the read head — or the
      // ghost would sit a keylock-latency away from the red needle it is drawn against.
      if (deckA.fluxMode) {
        const ghostXA = Math.round(centerPlayheadX + (deckA.fluxPosition - deckA.audiblePosition) / laneSecPerPx(secPerPx, deckA.rate))
        if (ghostXA >= 0 && ghostXA <= w) {
          ctx.fillStyle = '#22c55e'
          ctx.shadowColor = '#22c55e'
          ctx.shadowBlur = 4
          ctx.fillRect(ghostXA, 0, 1.5, halfH)
          ctx.fillRect(ghostXA - 2, 0, 5.5, 3)
          ctx.fillRect(ghostXA - 2, Math.round(halfH - 3), 5.5, 3)
          ctx.shadowBlur = 0
        }
      }

      if (deckB.fluxMode) {
        const ghostXB = Math.round(centerPlayheadX + (deckB.fluxPosition - deckB.audiblePosition) / laneSecPerPx(secPerPx, deckB.rate))
        if (ghostXB >= 0 && ghostXB <= w) {
          ctx.fillStyle = '#22c55e'
          ctx.shadowColor = '#22c55e'
          ctx.shadowBlur = 4
          ctx.fillRect(ghostXB, halfH, 1.5, halfH)
          ctx.fillRect(ghostXB - 2, Math.round(halfH), 5.5, 3)
          ctx.fillRect(ghostXB - 2, h - 3, 5.5, 3)
          ctx.shadowBlur = 0
        }
      }

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
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative overflow-hidden rounded-[3px] border border-[#282828] bg-[#161616] ${className}`}
    >
      {/* Drag & Drop Overlays for Deck A (Top Half) and Deck B (Bottom Half) */}
      {dragOverDeck === 'A' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 z-30 flex items-center justify-center bg-emerald-500/10 border-2 border-dashed border-emerald-400/70 backdrop-blur-[1px] transition-all">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#141414]/90 border border-emerald-500/60 text-emerald-400 text-xs font-bold shadow-lg">
            <span>Drop track to load Deck A</span>
          </div>
        </div>
      )}

      {dragOverDeck === 'B' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 z-30 flex items-center justify-center bg-purple-500/10 border-2 border-dashed border-purple-400/70 backdrop-blur-[1px] transition-all">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#141414]/90 border border-purple-500/60 text-purple-400 text-xs font-bold shadow-lg">
            <span>Drop track to load Deck B</span>
          </div>
        </div>
      )}

      {/* Global Waveform Zoom controls — centred on the seam between the two lanes, so
          the control that rescales both decks sits between them rather than in Deck A's
          corner. Translucent, because the playhead needle runs underneath it.

          The 24px between − and + is deliberately twice anything else in the row: the needle
          crosses this pill, and the gap is the only part of it that stays clear of a control,
          so it is where the playhead is meant to be read. */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center gap-6">
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={zoomOut}
          disabled={windowSeconds >= WINDOW_MAX_S}
          className="w-5 h-5 rounded bg-[#141414]/80 border border-[#282828] flex items-center justify-center text-[11px] font-bold text-[#888888] hover:text-[#d4d4d4] disabled:opacity-20 shadow-sm backdrop-blur-sm"
          title="Zoom out (or scroll down over the waveforms)"
        >
          −
        </button>
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={zoomIn}
          disabled={windowSeconds <= WINDOW_MIN_S}
          className="w-5 h-5 rounded bg-[#141414]/80 border border-[#282828] flex items-center justify-center text-[11px] font-bold text-[#888888] hover:text-[#d4d4d4] disabled:opacity-20 shadow-sm backdrop-blur-sm"
          title="Zoom in (or scroll up over the waveforms)"
        >
          +
        </button>
      </div>

      {/* Deck A Left: Rewind to start (|◀) - vertically centered on Deck A lane */}
      <div className="absolute top-[25%] -translate-y-1/2 left-2 z-10">
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            deckA.seek(0)
          }}
          disabled={!deckA.track}
          className="w-6 h-6 rounded bg-[#141414]/90 hover:bg-[#252525] border border-[#282828] hover:border-[#444444] active:bg-[#333333] text-[#888888] hover:text-white flex items-center justify-center transition-all shadow-sm backdrop-blur-sm disabled:opacity-20 disabled:pointer-events-none"
          title="Rewind to start of Deck A (|◀)"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3" aria-hidden="true">
            <path d="M2 3a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zm11.196 1.402A1 1 0 0 0 11.667 4L5.333 7.333a1 1 0 0 0 0 1.334l6.334 3.333A1 1 0 0 0 13.196 11.4V4.602a1 1 0 0 0 0-.2z" />
          </svg>
        </button>
      </div>

      {/* Deck B Left: Rewind to start (|◀) - vertically centered on Deck B lane */}
      <div className="absolute top-[75%] -translate-y-1/2 left-2 z-10">
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            deckB.seek(0)
          }}
          disabled={!deckB.track}
          className="w-6 h-6 rounded bg-[#141414]/90 hover:bg-[#252525] border border-[#282828] hover:border-[#444444] active:bg-[#333333] text-[#888888] hover:text-white flex items-center justify-center transition-all shadow-sm backdrop-blur-sm disabled:opacity-20 disabled:pointer-events-none"
          title="Rewind to start of Deck B (|◀)"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3" aria-hidden="true">
            <path d="M2 3a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zm11.196 1.402A1 1 0 0 0 11.667 4L5.333 7.333a1 1 0 0 0 0 1.334l6.334 3.333A1 1 0 0 0 13.196 11.4V4.602a1 1 0 0 0 0-.2z" />
          </svg>
        </button>
      </div>

      {/* Deck A Right: SET DOWNBEAT & GRID A controls */}
      {/* The downbeat anchor and the ±10ms nudge belong together — the anchor is what the nudge
          fine-tunes — so they keep the row's 6px. GRID is a different kind of control again and
          takes one extra step on top of it (ml-1.5, 12px total). */}
      <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            deckA.setBeat1AtPosition()
          }}
          disabled={!deckA.track}
          className="h-5 px-1.5 rounded bg-[#141414]/90 hover:bg-[#222222] border border-[#282828] hover:border-[#444444] text-[#888888] hover:text-white transition-colors shadow-sm backdrop-blur-sm flex items-center gap-1 disabled:opacity-20 disabled:pointer-events-none"
          title="Set Downbeat (Beat 1) at playhead"
        >
          {/* The marker wears the exact white the canvas paints its downbeat stripes, and the numeral
              simply takes the button's own colour — the same grey-then-white the GRID label uses, so
              the icon is what says "this is the downbeat" and the 1 is only the beat number. */}
          <svg
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            className="w-3 h-3"
            style={{ color: DOWNBEAT_STRIPE }}
            aria-hidden="true"
          >
            <path d="M7 1.5v8m-2.5-2.5L7 9.5l2.5-2.5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 12.5h10" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="font-mono font-bold text-[10px] leading-none">1</span>
        </button>

        {/* Inline grid nudge. Aligning a grid to a kick is a repeated tap-and-listen, and
            routing every one of those taps through the Grid dropdown was the complaint —
            so the ±10 ms step lives here, beside the downbeat button that anchors it.
            Shift-click still gives the 2 ms fine step the dropdown offers. */}
        <div className="flex items-center h-5 rounded border border-[#282828] bg-[#141414]/90 backdrop-blur-sm overflow-hidden shadow-sm">
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              deckA.nudgeBeatGrid(e.shiftKey ? -0.002 : -0.01)
            }}
            disabled={!deckA.track}
            className="h-full px-1 text-[10px] leading-none font-bold text-[#888888] hover:text-white hover:bg-[#222222] transition-colors disabled:opacity-20 disabled:pointer-events-none"
            title="Shift Deck A beatgrid 10 ms earlier (Shift-click for 2 ms)"
          >
            ◀
          </button>
          <span className="text-[8px] leading-none font-mono text-[#666666] select-none">10ms</span>
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              deckA.nudgeBeatGrid(e.shiftKey ? 0.002 : 0.01)
            }}
            disabled={!deckA.track}
            className="h-full px-1 text-[10px] leading-none font-bold text-[#888888] hover:text-white hover:bg-[#222222] transition-colors disabled:opacity-20 disabled:pointer-events-none"
            title="Shift Deck A beatgrid 10 ms later (Shift-click for 2 ms)"
          >
            ▶
          </button>
        </div>

        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setActiveGridDeckId(prev => (prev === 'A' ? null : 'A'))}
          className={`ml-1.5 h-5 px-2 rounded border text-[10px] font-bold tracking-wider uppercase transition-colors shadow-sm backdrop-blur-sm flex items-center gap-1 ${
            activeGridDeckId === 'A'
              ? 'bg-[#222222] border-emerald-500/70 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
              : 'bg-[#141414]/80 border-[#282828] text-[#888888] hover:text-[#d4d4d4] hover:border-[#444444]'
          }`}
          title="Adjust Deck A Beatgrid"
        >
          <span>GRID A</span>
          <span className="text-[9px] opacity-75">{activeGridDeckId === 'A' ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* Deck B Right: SET DOWNBEAT & GRID B controls */}
      <div className="absolute top-[calc(50%+6px)] right-2 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            deckB.setBeat1AtPosition()
          }}
          disabled={!deckB.track}
          className="h-5 px-1.5 rounded bg-[#141414]/90 hover:bg-[#222222] border border-[#282828] hover:border-[#444444] text-[#888888] hover:text-white transition-colors shadow-sm backdrop-blur-sm flex items-center gap-1 disabled:opacity-20 disabled:pointer-events-none"
          title="Set Downbeat (Beat 1) at playhead"
        >
          {/* Marker and numeral styled as on Deck A — see the note there. */}
          <svg
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            className="w-3 h-3"
            style={{ color: DOWNBEAT_STRIPE }}
            aria-hidden="true"
          >
            <path d="M7 1.5v8m-2.5-2.5L7 9.5l2.5-2.5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 12.5h10" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="font-mono font-bold text-[10px] leading-none">1</span>
        </button>

        {/* Inline grid nudge — see the Deck A copy above. */}
        <div className="flex items-center h-5 rounded border border-[#282828] bg-[#141414]/90 backdrop-blur-sm overflow-hidden shadow-sm">
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              deckB.nudgeBeatGrid(e.shiftKey ? -0.002 : -0.01)
            }}
            disabled={!deckB.track}
            className="h-full px-1 text-[10px] leading-none font-bold text-[#888888] hover:text-white hover:bg-[#222222] transition-colors disabled:opacity-20 disabled:pointer-events-none"
            title="Shift Deck B beatgrid 10 ms earlier (Shift-click for 2 ms)"
          >
            ◀
          </button>
          <span className="text-[8px] leading-none font-mono text-[#666666] select-none">10ms</span>
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              deckB.nudgeBeatGrid(e.shiftKey ? 0.002 : 0.01)
            }}
            disabled={!deckB.track}
            className="h-full px-1 text-[10px] leading-none font-bold text-[#888888] hover:text-white hover:bg-[#222222] transition-colors disabled:opacity-20 disabled:pointer-events-none"
            title="Shift Deck B beatgrid 10 ms later (Shift-click for 2 ms)"
          >
            ▶
          </button>
        </div>

        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setActiveGridDeckId(prev => (prev === 'B' ? null : 'B'))}
          className={`ml-1.5 h-5 px-2 rounded border text-[10px] font-bold tracking-wider uppercase transition-colors shadow-sm backdrop-blur-sm flex items-center gap-1 ${
            activeGridDeckId === 'B'
              ? 'bg-[#222222] border-purple-500/70 text-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.25)]'
              : 'bg-[#141414]/80 border-[#282828] text-[#888888] hover:text-[#d4d4d4] hover:border-[#444444]'
          }`}
          title="Adjust Deck B Beatgrid"
        >
          <span>GRID B</span>
          <span className="text-[9px] opacity-75">{activeGridDeckId === 'B' ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* Floating Beatgrid Adjustment Panel */}
      {activeGridDeckId && (
        <div
          onPointerDown={e => e.stopPropagation()}
          className={`absolute z-20 flex flex-wrap items-center gap-1.5 p-1.5 rounded bg-[#181818]/95 border border-[#333333] shadow-xl backdrop-blur-md text-[11px] select-none ${
            activeGridDeckId === 'A' ? 'top-8 right-2' : 'top-[calc(50%+30px)] right-2'
          }`}
        >
          {/* Deck Badge */}
          <div className="flex items-center rounded bg-[#101010] px-2 py-0.5 border border-[#262626]">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${
                activeGridDeckId === 'A' ? 'text-[#34d399]' : 'text-[#c084fc]'
              }`}
            >
              Deck {activeGridDeckId}
            </span>
          </div>

          <div className="h-4 w-[1px] bg-[#2a2a2a]" />

          {/* Variable-tempo marker: this grid follows measured beats, not one tempo */}
          {driftLabel && (
            <div
              className="flex items-center gap-1 rounded bg-[#101010] px-2 py-0.5 border border-amber-500/40"
              title="Variable-tempo grid: ticks are the analyser's measured beats, so they stay locked through tempo drift"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                VAR
              </span>
              <span className="text-[9px] font-mono text-[#cccccc]">{driftLabel}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => activeGridDeck.setBeat1AtPosition()}
            disabled={!activeGridDeck.track}
            className="h-5 px-2 rounded bg-[#202020] border border-[#333333] hover:border-[#666666] text-white hover:text-white text-[10px] font-bold uppercase disabled:opacity-30 transition-colors flex items-center gap-1"
            title="Set Downbeat (Beat 1) at the red playhead needle"
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" className="w-2.5 h-2.5 text-emerald-400" aria-hidden="true">
              <path d="M7 1.5v8m-2.5-2.5L7 9.5l2.5-2.5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 12.5h10" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>SET DOWNBEAT</span>
          </button>

          {/* Shift Bar by ±1 Beat */}
          <div className="flex items-center gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-[#666666] mr-0.5 font-bold">Bar</span>
            <button
              type="button"
              onClick={() => activeGridDeck.shiftBarPhase(-1)}
              disabled={!activeGridDeck.track}
              className="h-5 px-1.5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white font-mono text-[10px] font-bold disabled:opacity-30"
              title="Shift Bar (downbeat white stripes) 1 beat earlier"
            >
              &lt;
            </button>
            <button
              type="button"
              onClick={() => activeGridDeck.shiftBarPhase(1)}
              disabled={!activeGridDeck.track}
              className="h-5 px-1.5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white font-mono text-[10px] font-bold disabled:opacity-30"
              title="Shift Bar (downbeat white stripes) 1 beat later"
            >
              &gt;
            </button>
          </div>

          <div className="h-4 w-[1px] bg-[#2a2a2a]" />

          {/* Shift / Nudge Grid Offset */}
          <div className="flex items-center gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-[#666666] mr-0.5 font-bold">Shift</span>
            <button
              type="button"
              onClick={e => activeGridDeck.nudgeBeatGrid(e.shiftKey ? -0.002 : -0.01)}
              disabled={!activeGridDeck.track}
              className="h-5 px-1.5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white font-mono text-[10px] font-bold disabled:opacity-30"
              title="Shift beatgrid left 10ms (Shift-click for 2ms fine step)"
            >
              ◀ 10ms
            </button>
            <button
              type="button"
              onClick={e => activeGridDeck.nudgeBeatGrid(e.shiftKey ? 0.002 : 0.01)}
              disabled={!activeGridDeck.track}
              className="h-5 px-1.5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white font-mono text-[10px] font-bold disabled:opacity-30"
              title="Shift beatgrid right 10ms (Shift-click for 2ms fine step)"
            >
              10ms ▶
            </button>
          </div>

          <div className="h-4 w-[1px] bg-[#2a2a2a]" />

          {/* Fine BPM stretch/compress */}
          <div className="flex items-center gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-[#666666] mr-0.5 font-bold">Grid BPM</span>
            <button
              type="button"
              onClick={() => activeGridDeck.adjustGridBpm(-0.1)}
              disabled={!activeGridDeck.track}
              className="h-5 w-5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white font-mono text-[11px] font-bold disabled:opacity-30 flex items-center justify-center"
              title="Compress grid: −0.1 BPM"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => activeGridDeck.adjustGridBpm(0.1)}
              disabled={!activeGridDeck.track}
              className="h-5 w-5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white font-mono text-[11px] font-bold disabled:opacity-30 flex items-center justify-center"
              title="Stretch grid: +0.1 BPM"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => activeGridDeck.multiplyGridBpm(0.5)}
              disabled={!activeGridDeck.track}
              className="h-5 px-1.5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white font-mono text-[10px] font-bold disabled:opacity-30"
              title="Halve grid BPM (/2)"
            >
              /2
            </button>
            <button
              type="button"
              onClick={() => activeGridDeck.multiplyGridBpm(2)}
              disabled={!activeGridDeck.track}
              className="h-5 px-1.5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white font-mono text-[10px] font-bold disabled:opacity-30"
              title="Double grid BPM (x2)"
            >
              x2
            </button>
          </div>

          <div className="h-4 w-[1px] bg-[#2a2a2a]" />

          {/* Close button */}
          <button
            type="button"
            onClick={() => setActiveGridDeckId(null)}
            className="h-5 w-5 rounded bg-transparent hover:bg-[#282828] text-[#777777] hover:text-[#d4d4d4] flex items-center justify-center text-[10px]"
            title="Close beatgrid adjustment panel"
          >
            ✕
          </button>
        </div>
      )}

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
  deckLetter,
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
  deckLetter: 'A' | 'B'
  topY: number
  laneH: number
  /** Width of the lane in playback seconds. */
  windowSeconds: number
  /** Playback seconds per pixel, `windowSeconds / laneWidth`. The lane's own source
   *  axis is this scaled by the deck's rate; see {@link laneTimebase}. */
  secPerPx: number
  waveColor: string
  beatColor: string
  downbeatColor: string
}) {
  const track = deck.track
  // Lanes draw in CSS pixels, so recover the lane width from the scale the draw loop set on the
  // context (a rounded device pixel ratio). Dividing by devicePixelRatio instead would disagree
  // with the backing store by up to half a pixel, which the lane maths would carry into every x.
  const scaleX = ctx.getTransform().a || 1
  const w = ctx.canvas.width / scaleX
  const midY = topY + laneH / 2

  if (!track) {
    // Subtle horizontal center baseline
    ctx.strokeStyle = '#222222'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(w, midY)
    ctx.stroke()

    // Squared DJ Deck Letter Badge in center (grayscaled, matching artwork box style)
    const centerX = w / 2
    const boxSize = 36
    const halfBox = boxSize / 2

    ctx.save()
    ctx.fillStyle = '#161616'
    ctx.strokeStyle = '#282828'
    ctx.lineWidth = 1.5

    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath()
      ctx.roundRect(centerX - halfBox, midY - halfBox, boxSize, boxSize, 3)
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.rect(centerX - halfBox, midY - halfBox, boxSize, boxSize)
      ctx.fill()
      ctx.stroke()
    }

    // Grayscaled Deck Letter text
    ctx.font = 'bold 15px Inter, ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#888888'
    ctx.fillText(deckLetter, centerX, midY)
    ctx.restore()
    return
  }

  const peaks = getZoomPeaks(track)
  // Centre the lane on what is being *heard*, not on the read head. With keylock engaged
  // the engine holds the audio back ~133 ms, so centring on `position` would put the
  // playhead a quarter of a beat ahead of the beat you can hear — and, with the decks on
  // different rates, would line the two grids up differently. See `audiblePosition`.
  const pos = deck.audiblePosition
  // The lane is drawn on a playback-time axis, not on this track's own source axis, so
  // that a beat-synced pair lines up across both lanes. See waveform-timebase.ts.
  const tb = laneTimebase(pos, windowSeconds, secPerPx, deck.rate)
  const windowEnd = tb.tStart + w * tb.secPerPx

  // 1. Beatgrid Ticks
  const grid = track.grid
  if (grid) {
    const bpb = grid.beatsPerBar || 4
    const anchorBeat = downbeatIndex(grid)

    const drawTick = (t: number, isDownbeat: boolean) => {
      const x = laneX(t, tb)
      ctx.fillStyle = isDownbeat ? downbeatColor : beatColor
      ctx.globalAlpha = isDownbeat ? 0.85 : 0.45
      ctx.fillRect(x - (isDownbeat ? 1 : 0.5), topY, isDownbeat ? 2 : 1, laneH)
    }

    if (isVariableGrid(grid)) {
      // Variable tempo: draw the analyser's measured beat positions so the ticks
      // stay on the audio instead of sliding away as the track drifts.
      const beats = grid.beats as number[]
      const firstIndex = Math.max(0, Math.floor(beatIndexAt(grid, tb.tStart)))
      for (let i = firstIndex; i < beats.length; i++) {
        const t = beats[i]
        if (t > windowEnd) break
        if (t < 0) continue
        drawTick(t, (((i - anchorBeat) % bpb) + bpb) % bpb === 0)
      }
    } else {
      const beatLen = 60 / grid.bpm
      const firstVisibleBeat = Math.ceil((tb.tStart - grid.firstBeat) / beatLen)
      for (let k = firstVisibleBeat; ; k++) {
        const t = grid.firstBeat + k * beatLen
        if (t > windowEnd) break
        if (t < 0) continue
        const beatsFromBar = Math.round((t - grid.firstBar) / beatLen)
        drawTick(t, ((beatsFromBar % bpb) + bpb) % bpb === 0)
      }
    }

    // 1b. Section markers. The drops are where a mix wants to arrive (the end of
    // an intro or breakdown) and the phrase boundaries are the bars counted from
    // bar 1 — both come from the analyzer, not from the drawing code. Phrase
    // boundaries are only drawn when the analyzer measured a phrase length: an
    // 8-bar line on a track whose phrases were never measured would be a guess
    // drawn as a fact.
    if (grid.barStructure?.phraseSource === 'drops') {
      ctx.fillStyle = MARKER_PHRASE
      ctx.globalAlpha = 0.9
      for (const t of phraseBoundaries(grid, tb.tStart, windowEnd)) {
        const x = laneX(t, tb)
        if (x < -4 || x > w + 4) continue
        // A cap on the top edge of the lane, not a full-height line: a phrase
        // boundary always lands on a downbeat, so a full-height grey line would
        // sit under the white downbeat stripe where nobody can see it.
        ctx.fillRect(x - 3, topY, 6, 3)
      }
    }
    for (const drop of dropMarkers(grid)) {
      const x = laneX(drop.time, tb)
      if (x < -4 || x > w + 4) continue
      ctx.fillStyle = MARKER_DROP
      ctx.globalAlpha = 0.95
      ctx.fillRect(x - 0.5, topY, 1, laneH)
      ctx.beginPath()
      ctx.moveTo(x - 4, topY)
      ctx.lineTo(x + 4, topY)
      ctx.lineTo(x, topY + 7)
      ctx.closePath()
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // 2. Loop Region highlight (Traktor Emerald Green with center handle)
  if (deck.loop) {
    const x1 = laneX(deck.loop.start, tb)
    const x2 = laneX(deck.loop.end, tb)
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
    const t = tb.tStart + x * tb.secPerPx
    if (t < 0 || t >= track.duration) continue
    const idx = Math.floor((t / track.duration) * peaks.length)
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
    const x = laneX(cue, tb)
    if (x < 0 || x > w) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x - 1, topY, 2, laneH)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 9px Inter, ui-sans-serif, sans-serif'
    ctx.fillText(`${i + 1}`, x + 3, topY + 12)
  })
}
