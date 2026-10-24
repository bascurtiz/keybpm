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
import { canvasPixelRatio } from '@/lib/canvas-dpr'
import { consoleProfile } from '@/lib/dj/device-profile'
import { laneBadge } from '@/lib/dj/lane-badge'
import { ACTIVE_DECK_A, ACTIVE_DECK_B } from '@/lib/dj/control-state'

interface StackedWaveformsProps {
  deckA: DeckEngine
  deckB: DeckEngine
  className?: string
  onDropFile?: (deckId: 'A' | 'B', file: File) => void
  onLoadClick?: (deckId: 'A' | 'B') => void
  /**
   * Draw the floating clusters over the lanes — zoom, rewind to start, set downbeat,
   * ±10 ms nudge and the GRID dropdowns. Off leaves the canvas alone.
   *
   * The canvas itself (both lanes, beatgrid, playhead, drag or tap to seek, drop a file)
   * works the same either way.
   */
  chrome?: boolean
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
 * The canvas paints both decks from this one value, so the stripes a Set-Downbeat press
 * produces are the same white in both lanes.
 */
const DOWNBEAT_STRIPE = '#f4f4f5'

/**
 * The lane's grid tools — Set Downbeat, the ±10 ms nudges and the GRID dropdown — share one
 * body: the same 24 px height, a solid #141414 fill, a #282828 hairline and the grey the GRID
 * label already used. They sit in a row beside the waveform and are read as one cluster, so
 * they are held together here instead of drifting apart one className at a time (the nudge was
 * a translucent #141414 pill, which made the trio look like three unrelated widgets).
 *
 * The 24 px is the rewind button's height (`w-6 h-6`) on the other end of these lanes: the two
 * ends of the lane are the same furniture, so they are the same size.
 */
const GRID_TOOL_BOX = 'h-6 rounded border border-[#282828] bg-[#141414] shadow-sm select-none active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)]'
const GRID_TOOL_TEXT = 'text-[#888888] hover:text-[#d4d4d4]'

/**
 * One direction of the inline ±10 ms nudge.
 *
 * Two of these sit side by side on the lane instead of one pill with a shared "10ms" between
 * its arrows: each direction is a target of its own, labelled with the step it makes, which is
 * the pair the GRID dropdown already shows. It also lets the step be set in the same 10 px type
 * as everything else here — in the old pill the label had to shrink to 8 px to fit.
 */
const NUDGE_BTN = `px-1.5 ${GRID_TOOL_BOX} ${GRID_TOOL_TEXT} hover:border-[#444444] font-mono text-[10px] leading-none font-bold whitespace-nowrap transition-colors flex items-center justify-center disabled:opacity-20 disabled:pointer-events-none`

/**
 * Invisible tap padding for the lane's controls on the fitted (phone) console.
 *
 * `max-lg` is the same 1024 px breakpoint `useViewportMode` calls kiosk, so this only
 * ever applies where the chassis is scaled down: a landscape phone fits it at about
 * 0.73, which draws these buttons at 14–17 CSS px — under half the 44 px a thumb wants
 * and below the 24 px a mouse comfortably hits. Redrawing them larger would change the
 * lane's proportions, so the drawn box stays exactly as it is and a transparent
 * pseudo-element around it takes the taps instead. Being a child of the button, a tap
 * anywhere on it *is* a tap on the button: no JS, no extra nodes, no state.
 *
 * The padding is 9 px a side vertically — there is nothing above or below these
 * controls but waveform — which turns a 20 px control into a 38 px one (15 → 28 CSS px
 * at the phone fit). Horizontally it is only 2 px: the controls sit 6 px apart in a
 * single row, and overlap there would let a near-miss pick the neighbouring beatgrid
 * tool. Callers add whatever horizontal padding they have room for.
 */
const TAP_PAD =
  "max-lg:relative max-lg:after:absolute max-lg:after:content-[''] max-lg:after:-top-[9px] max-lg:after:-bottom-[9px]"

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
  chrome = true,
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
    let frame = 0
    let drawn = 0
    let rect = { width: 0, height: 0 }

    // Re-measure immediately whenever the canvas or its container changes size
    const ro = new ResizeObserver(() => {
      rect = { width: 0, height: 0 }
    })
    ro.observe(canvas)

    // Both lanes, grid, peaks and playhead are cleared and redrawn in full; on a phone that is
    // half the frame budget of the console, so the hand-held profile draws every second frame.
    const profile = consoleProfile()
    const stride = profile.canvasStride
    // Hand-held screens show the same lane in far fewer pixels, where a 1.5 px needle and a
    // 2 px stripe start eating the beat grid they are drawn against. Every vertical rule on
    // the lane — playhead, downbeat, beat, loop edge — thins by the same step on that profile,
    // so the hierarchy between them survives the reduction.
    const thickBars = !profile.handheld
    const tick = () => {
      raf = requestAnimationFrame(tick)
      frame++
      // The cadence is counted in *drawn* frames, not animation frames: with a stride of two an
      // `% 8` on the animation-frame counter would land only on the frames that are skipped.
      if (frame % stride !== 0) return
      drawn++
      // A layout read, not a paint: the lanes are re-measured a few times a second instead of
      // sixty. The box only changes when the viewport does, and this canvas lives inside a
      // chassis scaled by a transform, so the read also has to be cheap enough that it does not
      // compete with the audio thread on a phone.
      if (rect.width === 0 || drawn % 8 === 0) rect = canvas.getBoundingClientRect()
      if (rect.width === 0) return
      const dpr = canvasPixelRatio()
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
      // How much the chassis transform shrinks the console on screen: the canvas is laid
      // out at the chassis's design width and drawn at its displayed width. Anything
      // inside the canvas that should match a DOM control's *visual* size (the empty-lane
      // letter badge) has to be multiplied by this; the wave, grid and playhead are all
      // sized in lane/canvas terms and do not.
      const uiScale = canvas.offsetWidth > 0 ? w / canvas.offsetWidth : 1

      // Render Deck A (Top Half, Green)
      renderDeckLane({
        ctx,
        deck: deckA,
        deckLetter: 'A',
        topY: 0,
        laneH: halfH,
        uiScale,
        windowSeconds,
        secPerPx,
        waveColor: '#34d399',
        beatColor: '#a1a1aa',
        downbeatColor: DOWNBEAT_STRIPE,
        thickBars,
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
        uiScale,
        windowSeconds,
        secPerPx,
        waveColor: '#a855f7',
        beatColor: '#a1a1aa',
        downbeatColor: DOWNBEAT_STRIPE,
        thickBars,
      })



      // Traktor Red Center Playhead Needle
      ctx.shadowBlur = 0
      ctx.fillStyle = '#ef4444'
      const playheadX = Math.round(centerPlayheadX)
      const needleW = thickBars ? 1.5 : 1
      const capW = thickBars ? 3.5 : 2.5
      ctx.fillRect(playheadX, 0, needleW, h)
      // Minimal precision tick caps at top, center divider, and bottom
      ctx.fillRect(playheadX - (capW - needleW) / 2, 0, capW, 2)
      ctx.fillRect(playheadX - (capW - needleW) / 2, Math.round(halfH - 1), capW, 2)
      ctx.fillRect(playheadX - (capW - needleW) / 2, h - 2, capW, 2)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [deckA, deckB, windowSeconds])

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative overflow-hidden rounded-[3px] border border-[#282828] bg-[#101010] ${className}`}
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

      {/* The overlay clusters below are one layer, shown or hidden together.

          The wrapper is `display: contents` rather than a box: the clusters inside it
          place themselves against this component's own `relative` root (`top-1/2`,
          `right-2`, …), and a wrapper that generated a box would become their containing
          block and move all of them. `display: none` in its place takes the whole layer
          out (`chrome={false}`). */}
      <div className={chrome ? 'contents' : 'hidden'}>
      {/* Global Waveform Zoom controls — centred on the seam between the two lanes, so
          the control that rescales both decks sits between them rather than in Deck A's
          corner. Translucent, because the playhead needle runs underneath it.

          The 112px between − and + is the whole point of this row: the needle crosses the
          pill at its centre, and the gap is the only part of it that stays clear of a
          control, so it is both where the playhead is read and the space that keeps a
          thumb off the wrong end. At the phone fit the pair lands ~75 CSS px apart — the
          two zoom steps are the one pair of controls on the console a slip between is
          most annoying, and there is nothing else on the seam to crowd. The buttons
          themselves stay 24px and carry a wider invisible tap pad, so the visible pair
          does not grow into the waveform while the hit areas do — and their marks are drawn
          at the two `|◀` buttons' 12 px, so the lane's controls read as one set. */}
      {/* Waveform Zoom Controls (− and + flanking the red playhead needle with fair spacing) */}
      <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-[146px] flex items-center justify-between z-20 pointer-events-none">
        {/* Zoom Out (−) on left of playhead */}
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={zoomOut}
          disabled={windowSeconds >= WINDOW_MAX_S}
          className={`${TAP_PAD} pointer-events-auto w-[22px] h-[22px] rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] flex items-center justify-center transition-all shadow-sm backdrop-blur-sm disabled:opacity-20 select-none`}
          title="Zoom out (−) — wider view (or scroll down)"
          aria-label="Zoom out waveforms"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            className="w-2.5 h-2.5"
            aria-hidden="true"
          >
            <path d="M3 8h10" />
          </svg>
        </button>

        {/* Zoom In (+) on right of playhead */}
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={zoomIn}
          disabled={windowSeconds <= WINDOW_MIN_S}
          className={`${TAP_PAD} pointer-events-auto w-[22px] h-[22px] rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] flex items-center justify-center transition-all shadow-sm backdrop-blur-sm disabled:opacity-20 select-none`}
          title="Zoom in (+) — closer view (or scroll up)"
          aria-label="Zoom in waveforms"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            className="w-2.5 h-2.5"
            aria-hidden="true"
          >
            <path d="M8 3v10M3 8h10" />
          </svg>
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
          className={`${TAP_PAD} max-lg:after:-inset-x-1.5 w-6 h-6 rounded bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] flex items-center justify-center transition-all shadow-sm backdrop-blur-sm disabled:opacity-20 disabled:pointer-events-none`}
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
          className={`${TAP_PAD} max-lg:after:-inset-x-1.5 w-6 h-6 rounded bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] flex items-center justify-center transition-all shadow-sm backdrop-blur-sm disabled:opacity-20 disabled:pointer-events-none`}
          title="Rewind to start of Deck B (|◀)"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3" aria-hidden="true">
            <path d="M2 3a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zm11.196 1.402A1 1 0 0 0 11.667 4L5.333 7.333a1 1 0 0 0 0 1.334l6.334 3.333A1 1 0 0 0 13.196 11.4V4.602a1 1 0 0 0 0-.2z" />
          </svg>
        </button>
      </div>

      {/* Deck A Right: SET DOWNBEAT & GRID A controls */}
      {/* Both the downbeat anchor on the left and the GRID dropdown on the right take an extra
          spacing step (mr-1.5 and ml-1.5, 12px total) away from the central ±10ms nudge pair. */}
      <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            deckA.setBeat1AtPosition()
          }}
          disabled={!deckA.track}
          className={`${TAP_PAD} max-lg:after:-inset-x-0.5 mr-1.5 px-2.5 ${GRID_TOOL_BOX} ${GRID_TOOL_TEXT} hover:border-[#444444] transition-colors flex items-center gap-[3px] disabled:opacity-20 disabled:pointer-events-none`}
          title="Set Downbeat (Beat 1) at playhead"
          aria-label="Set downbeat (beat 1) at the playhead"
        >
          {/* A bar and its numeral — the downbeat the grid draws, cut down to an icon.
              Drawn as a bar plus typed 1 rather than the characters "|1": a font's pipe has
              its own width and side bearing in every fallback, and this glyph has to sit
              centred in a 20 px button on every machine. Both parts take `currentColor`,
              so the pair reads as one mark instead of a white icon beside a grey digit.
              The numeral is set at the same 10 px as the nudge buttons' "10ms": the bar is
              the sign and the 1 is a beat number, not a title, so it takes their size. */}
          <span aria-hidden="true" className="block h-[11px] w-[2px] shrink-0 rounded-full bg-current" />
          <span aria-hidden="true" className="font-mono font-bold text-[10px] leading-none">1</span>
        </button>

        {/* Inline grid nudge. Aligning a grid to a kick is a repeated tap-and-listen, and
            routing every one of those taps through the Grid dropdown was the complaint —
            so the ±10 ms step lives here, beside the downbeat button that anchors it.
            Shift-click still gives the 2 ms fine step the dropdown offers.

            One button per direction, each carrying its own arrow and its own "10ms", the
            pair the GRID dropdown shows. The step used to be a label shared by two hairline
            arrows inside a single pill, which read as one control with a caption and left
            both halves too small to hit cleanly; two full buttons make each direction a
            target you can aim at. */}
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            deckA.nudgeBeatGrid(e.shiftKey ? -0.002 : -0.01)
          }}
          disabled={!deckA.track}
          className={`${TAP_PAD} max-lg:after:-inset-x-0.5 ${NUDGE_BTN}`}
          title="Shift Deck A beatgrid 10 ms earlier (Shift-click for 2 ms)"
          aria-label="Shift Deck A beatgrid 10 ms earlier"
        >
          ◀ 10ms
        </button>
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            deckA.nudgeBeatGrid(e.shiftKey ? 0.002 : 0.01)
          }}
          disabled={!deckA.track}
          className={`${TAP_PAD} max-lg:after:-inset-x-0.5 ${NUDGE_BTN}`}
          title="Shift Deck A beatgrid 10 ms later (Shift-click for 2 ms)"
          aria-label="Shift Deck A beatgrid 10 ms later"
        >
          10ms ▶
        </button>

        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setActiveGridDeckId(prev => (prev === 'A' ? null : 'A'))}
          className={`${TAP_PAD} max-lg:after:-inset-x-0.5 ml-1.5 h-6 px-2 rounded border text-[10px] font-bold tracking-wider uppercase transition-colors shadow-sm flex items-center gap-1 ${
            activeGridDeckId === 'A'
              ? ACTIVE_DECK_A
              : 'bg-[#141414] border-[#282828] text-[#888888] hover:text-[#d4d4d4] hover:border-[#444444] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)]'
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
          className={`${TAP_PAD} max-lg:after:-inset-x-0.5 mr-1.5 px-2.5 ${GRID_TOOL_BOX} ${GRID_TOOL_TEXT} hover:border-[#444444] transition-colors flex items-center gap-[3px] disabled:opacity-20 disabled:pointer-events-none`}
          title="Set Downbeat (Beat 1) at playhead"
          aria-label="Set downbeat (beat 1) at the playhead"
        >
          {/* Bar and numeral as on Deck A — see the note there. */}
          <span aria-hidden="true" className="block h-[11px] w-[2px] shrink-0 rounded-full bg-current" />
          <span aria-hidden="true" className="font-mono font-bold text-[10px] leading-none">1</span>
        </button>

        {/* Inline grid nudge — see the Deck A copy above. */}
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            deckB.nudgeBeatGrid(e.shiftKey ? -0.002 : -0.01)
          }}
          disabled={!deckB.track}
          className={`${TAP_PAD} max-lg:after:-inset-x-0.5 ${NUDGE_BTN}`}
          title="Shift Deck B beatgrid 10 ms earlier (Shift-click for 2 ms)"
          aria-label="Shift Deck B beatgrid 10 ms earlier"
        >
          ◀ 10ms
        </button>
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            deckB.nudgeBeatGrid(e.shiftKey ? 0.002 : 0.01)
          }}
          disabled={!deckB.track}
          className={`${TAP_PAD} max-lg:after:-inset-x-0.5 ${NUDGE_BTN}`}
          title="Shift Deck B beatgrid 10 ms later (Shift-click for 2 ms)"
          aria-label="Shift Deck B beatgrid 10 ms later"
        >
          10ms ▶
        </button>

        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setActiveGridDeckId(prev => (prev === 'B' ? null : 'B'))}
          className={`${TAP_PAD} max-lg:after:-inset-x-0.5 ml-1.5 h-6 px-2 rounded border text-[10px] font-bold tracking-wider uppercase transition-colors shadow-sm flex items-center gap-1 ${
            activeGridDeckId === 'B'
              ? ACTIVE_DECK_B
              : 'bg-[#141414] border-[#282828] text-[#888888] hover:text-[#d4d4d4] hover:border-[#444444] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)]'
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
            activeGridDeckId === 'A' ? 'top-9 right-2' : 'top-[calc(50%+34px)] right-2'
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
            {/* The same bar the lane's downbeat button uses, at the same size — the two
                buttons set the same thing, so they are marked with the same sign. In the
                button's own white, which is the colour the canvas paints its downbeat
                stripes. */}
            <span aria-hidden="true" className="block h-[11px] w-[2px] shrink-0 rounded-full bg-current" />
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
              className="h-5 px-1.5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white active:text-white active:border-white active:bg-[#101010] font-mono text-[10px] font-bold disabled:opacity-30"
              title="Shift beatgrid left 10ms (Shift-click for 2ms fine step)"
            >
              ◀ 10ms
            </button>
            <button
              type="button"
              onClick={e => activeGridDeck.nudgeBeatGrid(e.shiftKey ? 0.002 : 0.01)}
              disabled={!activeGridDeck.track}
              className="h-5 px-1.5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white active:text-white active:border-white active:bg-[#101010] font-mono text-[10px] font-bold disabled:opacity-30"
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
              className="h-5 w-5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white active:text-white active:border-white active:bg-[#101010] font-mono text-[11px] font-bold disabled:opacity-30 flex items-center justify-center"
              title="Compress grid: −0.1 BPM"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => activeGridDeck.adjustGridBpm(0.1)}
              disabled={!activeGridDeck.track}
              className="h-5 w-5 rounded bg-[#202020] border border-[#333333] hover:border-[#555] text-[#cccccc] hover:text-white active:text-white active:border-white active:bg-[#101010] font-mono text-[11px] font-bold disabled:opacity-30 flex items-center justify-center"
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
  deckLetter,
  topY,
  laneH,
  uiScale,
  windowSeconds,
  secPerPx,
  waveColor,
  beatColor,
  downbeatColor,
  thickBars,
}: {
  ctx: CanvasRenderingContext2D
  deck: DeckEngine
  deckLetter: 'A' | 'B'
  topY: number
  laneH: number
  /** Chassis scale for this canvas, so DOM-sized marks shrink with the console. */
  uiScale: number
  /** Full-width rules on desktop, hairline rules on the hand-held profile. */
  thickBars: boolean
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

    // Squared DJ Deck Letter Badge in center (grayscaled, matching artwork box style).
    // Drawn at the design size *through the chassis scale*, so it reads the same as the
    // A/B on the artwork squares above: a constant would be the one mark in the lane that
    // does not shrink with the console, which on a phone made it the loudest thing on the
    // waveform. See `laneBadge`.
    const badge = laneBadge(laneH, uiScale)
    const centerX = w / 2
    const halfBox = badge.box / 2

    ctx.save()
    ctx.fillStyle = '#101010'
    ctx.strokeStyle = '#282828'
    ctx.lineWidth = badge.stroke

    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath()
      ctx.roundRect(centerX - halfBox, midY - halfBox, badge.box, badge.box, badge.radius)
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.rect(centerX - halfBox, midY - halfBox, badge.box, badge.box)
      ctx.fill()
      ctx.stroke()
    }

    // Grayscaled Deck Letter text
    ctx.font = `bold ${badge.font}px Inter, ui-sans-serif, system-ui, sans-serif`
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
  // different rates, would line the two grids up differently. `displayPosition` is that
  // audible position projected onto the current audio-clock instant, so the lane moves
  // with the display instead of in the worklet's 30 Hz report steps.
  const pos = deck.displayPosition
  // The lane is drawn on a playback-time axis, not on this track's own source axis, so
  // that a beat-synced pair lines up across both lanes. See waveform-timebase.ts.
  const tb = laneTimebase(pos, windowSeconds, secPerPx, deck.rate)
  const windowEnd = tb.tStart + w * tb.secPerPx

  // 1. Beatgrid Ticks
  const grid = track.grid
  if (grid) {
    const bpb = grid.beatsPerBar || 4
    const anchorBeat = downbeatIndex(grid)

    // Downbeat wider than an ordinary beat, but never wider than the playhead it is read
    // against: at 2 px the white stripes were the heaviest vertical marks in the lane, so a
    // bar line looked more like the current position than the needle did. Brightness (0.85
    // against 0.45) carries the downbeat distinction; width stays at or under the needle.
    const downbeatW = thickBars ? 1.25 : 1
    const beatW = thickBars ? 1 : 0.75
    const drawTick = (t: number, isDownbeat: boolean) => {
      const x = laneX(t, tb)
      const tickW = isDownbeat ? downbeatW : beatW
      ctx.fillStyle = isDownbeat ? downbeatColor : beatColor
      ctx.globalAlpha = isDownbeat ? 0.85 : 0.45
      ctx.fillRect(x - tickW / 2, topY, tickW, laneH)
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
      const loopEdgeW = thickBars ? 2 : 1.25
      ctx.globalAlpha = 0.95
      ctx.fillStyle = '#22c55e'
      if (x1 >= 0 && x1 <= w) ctx.fillRect(x1 - loopEdgeW / 2, topY, loopEdgeW, laneH)
      if (x2 >= 0 && x2 <= w) ctx.fillRect(x2 - loopEdgeW / 2, topY, loopEdgeW, laneH)

      // Center Loop Handle, labelled with the loop's own length.
      //
      // It used to be three grip lines — the same mark for a 1-beat loop as for a 32-beat one,
      // which meant the lane never said how long the window was; you had to look down at the
      // transport for the number. The badge is on the thing it describes, so it says it.
      //
      // The length is measured against the local beat at the loop's start rather than against
      // `loop.bars`, because the beat-loop path (`setLoop`) leaves `bars` at 0 — and measured
      // locally so a loop armed on a drifting grid reports the beats you can actually count.
      const beatLen = deck.beatLengthAt(deck.loop.start)
      const beats = beatLen > 0 ? (deck.loop.end - deck.loop.start) / beatLen : 0
      // Below a beat, say `1/2` rather than `0.5` — the console's own loop readouts already
      // speak in that notation, and a leading `0.` reads as a timecode here.
      let label = ''
      if (beats >= 0.875) {
        label = String(Math.round(beats))
      } else if (beats > 0) {
        const denom = Math.round(1 / beats)
        label = denom > 1 ? `1/${denom}` : '1'
      }

      // Measure font & text so the chip wraps the number with balanced padding instead of
      // drawing a stretched wide pill on mobile screens.
      const fontSize = thickBars ? 9 : 8.5
      const fontStr = `700 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`
      ctx.font = fontStr
      const textW = label ? ctx.measureText(label).width : 0

      // Proportional chip sizing: height is 12.5px (mobile) / 14px (desktop).
      // Width fits the text tightly (8-10px padding total) so "4" is a compact badge.
      const handleH = thickBars ? 14 : 12.5
      const handleW = label ? Math.max(handleH + 2, Math.round(textW + (thickBars ? 10 : 8))) : 16
      const handleY = topY + laneH - handleH - (thickBars ? 3 : 2)
      const midX = (startX + endX) / 2

      if (loopWidth > handleW + 4 && label) {
        const radius = Math.min(3.5, handleH / 3)
        ctx.save()
        ctx.fillStyle = '#14532d'
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.roundRect(midX - handleW / 2, handleY, handleW, handleH, radius)
        ctx.fill()
        ctx.strokeStyle = '#22c55e'
        ctx.lineWidth = 1
        ctx.stroke()

        // The count itself, in the deck's loop green so it belongs to the window behind it.
        ctx.globalAlpha = 1
        ctx.fillStyle = '#86efac'
        ctx.font = fontStr
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, midX, handleY + handleH / 2 + 0.5)
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }
  }

  // 3. Multi-layer Waveform Envelope (Beatport DJ style outer body + solid core)
  //
  // Four filled paths, not four draws per column. A lane is ~740 columns wide on a landscape
  // phone, so the per-column version issued ~3,000 canvas calls and ~3,000 style changes per
  // frame — for two decks that is most of a phone's frame budget spent rebuilding a picture
  // that never changes shape, only moves. Building each path is the same walk over the peaks;
  // filling it is one call. Measured 1.9x faster for identical output at 740x360.
  const playedColumns = Math.min(w, Math.max(0, Math.floor((pos - tb.tStart) / tb.secPerPx) + 1))
  const columnPath = (from: number, to: number, inner: boolean) => {
    ctx.beginPath()
    for (let x = from; x < to; x++) {
      const t = tb.tStart + x * tb.secPerPx
      if (t < 0 || t >= track.duration) continue
      const idx = Math.floor((t / track.duration) * peaks.length)
      const val = peaks[idx] ?? 0
      const ampOuter = Math.max(val * (laneH / 2 - 3), 0.5)
      const amp = inner ? Math.max(ampOuter * 0.52, 0.5) : ampOuter
      ctx.rect(x, midY - amp, 1, amp * 2)
    }
    ctx.fill()
  }

  ctx.fillStyle = waveColor
  // Outer body
  ctx.globalAlpha = 0.35
  columnPath(playedColumns, w, false)
  ctx.globalAlpha = 0.55
  columnPath(0, playedColumns, false)
  // Inner bright core
  ctx.globalAlpha = 0.75
  columnPath(playedColumns, w, true)
  ctx.globalAlpha = 1.0
  columnPath(0, playedColumns, true)
  ctx.globalAlpha = 1

  // 4. Hot Cues flags
  deck.hotCues.forEach((cue, i) => {
    if (cue === null) return
    const x = laneX(cue, tb)
    if (x < 0 || x > w) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x - 1, topY, 2, laneH)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 9px Inter, sans-serif'
    ctx.fillText(`${i + 1}`, x + 3, topY + 12)
  })
}
