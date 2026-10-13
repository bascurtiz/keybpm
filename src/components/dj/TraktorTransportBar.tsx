import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { Fader } from './Fader'

interface TraktorTransportBarProps {
  engine: AudioEngine
  className?: string
}

export function TraktorTransportBar({ engine, className = '' }: TraktorTransportBarProps) {
  const deckA = engine.decks.A
  const deckB = engine.decks.B

  const [, setVer] = useState(0)
  useEffect(() => {
    const unE = engine.subscribe(() => setVer(v => v + 1))
    const unA = deckA.subscribe(() => setVer(v => v + 1))
    const unB = deckB.subscribe(() => setVer(v => v + 1))
    return () => {
      unE()
      unA()
      unB()
    }
  }, [engine, deckA, deckB])

  const nudgeCrossfade = (delta: number) => {
    engine.setCrossfade(engine.crossfade + delta)
  }

  return (
    <div
      className={`w-full bg-[#161616] border-t border-[#282828] px-3 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-4 select-none ${className}`}
    >
      {/* ================= DECK A TRANSPORT (LEFT) ================= */}
      <div className="flex items-center justify-start">
        <DeckTransport deck={deckA} deckId="A" />
      </div>

      {/* ================= CENTER: CROSSFADER (CENTERED UNDER MIXER) ================= */}
      <div className="w-[380px] flex items-center justify-center">
        <div className="w-[200px] flex items-center justify-between gap-1.5 px-2.5 py-1 bg-[#141414] rounded-lg border border-[#282828]">
          <button
            type="button"
            onClick={() => nudgeCrossfade(-0.05)}
            className="text-xs font-bold text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222] rounded px-1 py-0.5 transition-colors select-none"
            title="Nudge Crossfader toward Deck A"
          >
            &lt;
          </button>

          <Fader
            min={-1}
            max={1}
            step={0.01}
            value={engine.crossfade}
            defaultValue={0}
            bipolar
            snapCenter
            ticks={5}
            onValueChange={v => engine.setCrossfade(v)}
            label="Crossfader"
            className="h-6 w-[140px] max-w-[140px]"
          />

          <button
            type="button"
            onClick={() => nudgeCrossfade(0.05)}
            className="text-xs font-bold text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222] rounded px-1 py-0.5 transition-colors select-none"
            title="Nudge Crossfader toward Deck B"
          >
            &gt;
          </button>
        </div>
      </div>

      {/* ================= DECK B TRANSPORT (RIGHT) ================= */}
      <div className="flex items-center justify-end">
        <DeckTransport deck={deckB} deckId="B" />
      </div>
    </div>
  )
}

const LOOP_BEAT_SIZES = [1, 2, 4, 8, 16, 32]

function DeckTransport({ deck, deckId }: { deck: DeckEngine; deckId: 'A' | 'B' }) {
  const [selectedLoopIdx, setSelectedLoopIdx] = useState(2) // Default 4 beats
  const currentBeats = LOOP_BEAT_SIZES[selectedLoopIdx]
  const isPlaying = deck.playing
  const isLoopActive = Boolean(deck.loop)

  // Tap Tempo
  const tapTimesRef = useRef<number[]>([])
  const [isTapping, setIsTapping] = useState(false)
  const tapTimeoutRef = useRef<number | null>(null)

  const handleTapTempo = () => {
    if (!deck.track) return
    const now = performance.now()
    const taps = tapTimesRef.current

    // Reset if last tap was more than 2 seconds ago
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      tapTimesRef.current = [now]
    } else {
      taps.push(now)
      if (taps.length > 5) taps.shift() // keep last 5 taps
    }

    setIsTapping(true)
    if (tapTimeoutRef.current) window.clearTimeout(tapTimeoutRef.current)
    tapTimeoutRef.current = window.setTimeout(() => setIsTapping(false), 300)

    if (taps.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1])
      }
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
      if (avgMs > 0) {
        const calculatedBpm = Math.max(30, Math.min(300, Math.round((60000 / avgMs) * 10) / 10))
        deck.setTrackBpm(calculatedBpm)
      }
    }
  }

  const toggleLoop = () => {
    if (!deck.track) return
    if (deck.loop) {
      deck.exitLoop()
    } else {
      const grid = deck.track.grid
      const bpm = grid?.bpm || deck.effectiveBpm || deck.track.bpm || 120
      const beatLen = 60 / bpm
      const loopLenSeconds = currentBeats * beatLen
      const start = deck.snapToBeat(deck.position)
      deck.setLoop(start, start + loopLenSeconds)
    }
  }

  const loopHalf = () => {
    const nextIdx = Math.max(0, selectedLoopIdx - 1)
    setSelectedLoopIdx(nextIdx)
    if (deck.loop && deck.track) {
      const bpm = deck.track.grid?.bpm || deck.effectiveBpm || deck.track.bpm || 120
      const beatLen = 60 / bpm
      const halfBeats = LOOP_BEAT_SIZES[nextIdx]
      const halfLen = halfBeats * beatLen
      deck.setLoop(deck.loop.start, deck.loop.start + halfLen)
    }
  }

  const loopDouble = () => {
    const nextIdx = Math.min(LOOP_BEAT_SIZES.length - 1, selectedLoopIdx + 1)
    setSelectedLoopIdx(nextIdx)
    if (deck.loop && deck.track) {
      const bpm = deck.track.grid?.bpm || deck.effectiveBpm || deck.track.bpm || 120
      const beatLen = 60 / bpm
      const doubleBeats = LOOP_BEAT_SIZES[nextIdx]
      const doubleLen = doubleBeats * beatLen
      deck.setLoop(deck.loop.start, deck.loop.start + doubleLen)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Play / Pause button matching Traktor */}
      <button
        type="button"
        onClick={() => void deck.togglePlay()}
        disabled={!deck.track}
        className={`h-11 w-14 rounded-md border flex items-center justify-center transition-all shadow-sm select-none ${
          isPlaying
            ? 'bg-[#141414] border-white text-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
            : 'bg-[#141414] border-[#282828] text-[#666666] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-40'
        }`}
        title={`Deck ${deckId} Play / Pause (Space / Click)`}
      >
        <span className="text-base font-bold">▶</span>
      </button>

      {/* CUE button matching Traktor */}
      <button
        type="button"
        onClick={() => void deck.cue()}
        disabled={!deck.track}
        className="h-11 px-4 rounded-md border text-xs font-bold uppercase tracking-wider flex items-center justify-center transition-all shadow-sm select-none bg-[#141414] border-[#282828] text-[#666666] hover:text-[#d4d4d4] hover:border-[#444444] active:border-white active:text-white disabled:opacity-40"
        title={`Deck ${deckId} Cue (Return to cue point or set new cue)`}
      >
        CUE
      </button>

      {/* Loop / Beat Jump Section: < [ 4 BEATS ] > */}
      <div className={`flex items-center rounded-md border overflow-hidden shadow-sm h-11 transition-colors ${
        isLoopActive ? 'border-white bg-[#141414] shadow-[0_0_8px_rgba(255,255,255,0.25)]' : 'border-[#282828] bg-[#141414]'
      }`}>
        <button
          type="button"
          onClick={loopHalf}
          disabled={!deck.track || selectedLoopIdx === 0}
          className={`h-full px-2.5 text-xs font-bold text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222] disabled:opacity-25 transition-colors border-r ${
            isLoopActive ? 'border-white/30' : 'border-[#282828]'
          }`}
          title="Half loop length (÷2)"
        >
          &lt;
        </button>

        <button
          type="button"
          onClick={toggleLoop}
          disabled={!deck.track}
          className={`h-full px-3 flex flex-col items-center justify-center transition-colors ${
            isLoopActive
              ? 'bg-[#141414] text-white'
              : 'hover:bg-[#222222] text-[#666666] hover:text-[#d4d4d4]'
          }`}
          title={`Loop ${currentBeats} beats (Click to toggle)`}
        >
          <span
            className={`text-xs font-mono font-bold leading-none ${
              isLoopActive ? 'text-white' : 'text-[#777777]'
            }`}
          >
            {currentBeats}
          </span>
          <span
            className={`text-[7.5px] font-sans font-bold uppercase tracking-widest leading-none mt-0.5 ${
              isLoopActive ? 'text-white' : 'text-[#666666]'
            }`}
          >
            BEATS
          </span>
        </button>

        <button
          type="button"
          onClick={loopDouble}
          disabled={!deck.track || selectedLoopIdx === LOOP_BEAT_SIZES.length - 1}
          className={`h-full px-2.5 text-xs font-bold text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222] disabled:opacity-25 transition-colors border-l ${
            isLoopActive ? 'border-white/30' : 'border-[#282828]'
          }`}
          title="Double loop length (×2)"
        >
          &gt;
        </button>
      </div>

      {/* Tap Tempo Button: TAP */}
      <button
        type="button"
        onClick={handleTapTempo}
        disabled={!deck.track}
        className={`h-11 px-3 rounded-md border text-[11px] font-bold uppercase tracking-wider flex items-center justify-center transition-all shadow-sm select-none ${
          isTapping
            ? 'bg-[#1e1e1e] border-white text-white shadow-[0_0_8px_rgba(255,255,255,0.3)] scale-[0.97]'
            : 'bg-[#141414] border-[#282828] text-[#666666] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-40'
        }`}
        title={`Deck ${deckId} Tap Tempo — Click repeatedly in rhythm to set BPM`}
      >
        TAP
      </button>
    </div>
  )
}
