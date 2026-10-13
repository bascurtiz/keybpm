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

  const [loopBeatsA, setLoopBeatsA] = useState(4)
  const [loopBeatsB, setLoopBeatsB] = useState(4)

  // Auto-Fade animation state
  const autoFadeRafRef = useRef<number | null>(null)
  const [isFading, setIsFading] = useState<'left' | 'right' | null>(null)

  const triggerAutoFade = (targetDirection: 'left' | 'right') => {
    if (autoFadeRafRef.current) {
      cancelAnimationFrame(autoFadeRafRef.current)
      autoFadeRafRef.current = null
    }

    const startVal = engine.crossfade
    const targetVal = targetDirection === 'left' ? -1 : 1
    if (Math.abs(startVal - targetVal) < 0.001) return

    // Duration in seconds: based on loop beats of the playing or target deck
    const relevantDeck = targetDirection === 'left' ? deckA : deckB
    const otherDeck = targetDirection === 'left' ? deckB : deckA
    const activeDeck = relevantDeck.playing ? relevantDeck : otherDeck.playing ? otherDeck : relevantDeck
    const beats = targetDirection === 'left' ? loopBeatsA : loopBeatsB
    const bpm = activeDeck.effectiveBpm || activeDeck.track?.bpm || engine.masterBpm || 128
    const beatSec = 60 / bpm
    const durationMs = Math.max(500, beats * beatSec * 1000)

    const startTime = performance.now()
    setIsFading(targetDirection)

    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / durationMs)
      // Smooth linear or slightly eased progress
      const currentVal = startVal + (targetVal - startVal) * progress
      engine.setCrossfade(currentVal)

      if (progress < 1) {
        autoFadeRafRef.current = requestAnimationFrame(step)
      } else {
        engine.setCrossfade(targetVal)
        autoFadeRafRef.current = null
        setIsFading(null)
      }
    }

    autoFadeRafRef.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    return () => {
      if (autoFadeRafRef.current) cancelAnimationFrame(autoFadeRafRef.current)
    }
  }, [])

  const nudgeCrossfade = (delta: number) => {
    if (autoFadeRafRef.current) {
      cancelAnimationFrame(autoFadeRafRef.current)
      autoFadeRafRef.current = null
      setIsFading(null)
    }
    engine.setCrossfade(engine.crossfade + delta)
  }

  return (
    <div
      className={`w-full bg-[#161616] border-t border-[#282828] px-3 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-4 select-none ${className}`}
    >
      {/* ================= DECK A TRANSPORT (LEFT) ================= */}
      <div className="flex items-center justify-start">
        <DeckTransport deck={deckA} deckId="A" onLoopBeatsChange={setLoopBeatsA} />
      </div>

      {/* ================= CENTER: AUTO-FADE CHEVRONS + CROSSFADER (CENTERED UNDER MIXER) ================= */}
      <div className="w-[380px] flex items-center justify-center gap-2">
        {/* Auto-fade Left: << */}
        <button
          type="button"
          onClick={() => triggerAutoFade('left')}
          className={`h-7 px-1.5 rounded text-[11px] font-mono font-bold tracking-tighter flex items-center justify-center transition-all ${
            isFading === 'left'
              ? 'bg-[#34d399]/20 text-[#34d399] border border-[#34d399]/50 shadow-[0_0_8px_rgba(52,211,153,0.3)] animate-pulse'
              : 'text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222]'
          }`}
          title={`Auto-fade to Deck A over ${loopBeatsA} beats`}
        >
          &lt;&lt;
        </button>

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
            onValueChange={v => {
              if (autoFadeRafRef.current) {
                cancelAnimationFrame(autoFadeRafRef.current)
                autoFadeRafRef.current = null
                setIsFading(null)
              }
              engine.setCrossfade(v)
            }}
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

        {/* Auto-fade Right: >> */}
        <button
          type="button"
          onClick={() => triggerAutoFade('right')}
          className={`h-7 px-1.5 rounded text-[11px] font-mono font-bold tracking-tighter flex items-center justify-center transition-all ${
            isFading === 'right'
              ? 'bg-[#a855f7]/20 text-[#a855f7] border border-[#a855f7]/50 shadow-[0_0_8px_rgba(168,85,247,0.3)] animate-pulse'
              : 'text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222]'
          }`}
          title={`Auto-fade to Deck B over ${loopBeatsB} beats`}
        >
          &gt;&gt;
        </button>
      </div>

      {/* ================= DECK B TRANSPORT (RIGHT) ================= */}
      <div className="flex items-center justify-end">
        <DeckTransport deck={deckB} deckId="B" onLoopBeatsChange={setLoopBeatsB} />
      </div>
    </div>
  )
}

const LOOP_BEAT_SIZES = [1, 2, 4, 8, 16, 32]

function DeckTransport({
  deck,
  deckId,
  onLoopBeatsChange,
}: {
  deck: DeckEngine
  deckId: 'A' | 'B'
  onLoopBeatsChange?: (beats: number) => void
}) {
  const [selectedLoopIdx, setSelectedLoopIdx] = useState(2) // Default 4 beats
  const currentBeats = LOOP_BEAT_SIZES[selectedLoopIdx]
  const isPlaying = deck.playing
  const isLoopActive = Boolean(deck.loop)

  useEffect(() => {
    onLoopBeatsChange?.(currentBeats)
  }, [currentBeats, onLoopBeatsChange])

  // 4-Tap Tempo System
  const tapTimesRef = useRef<number[]>([])
  const [tapCount, setTapCount] = useState(0)
  const tapResetTimerRef = useRef<number | null>(null)

  const handleTapTempo = () => {
    if (!deck.track) return
    const now = performance.now()
    const taps = tapTimesRef.current

    // Reset if previous tap was more than 2.5 seconds ago
    if (taps.length > 0 && now - taps[taps.length - 1] > 2500) {
      taps.length = 0
    }

    taps.push(now)
    const count = taps.length
    setTapCount(count)

    if (tapResetTimerRef.current) window.clearTimeout(tapResetTimerRef.current)
    tapResetTimerRef.current = window.setTimeout(() => {
      taps.length = 0
      setTapCount(0)
    }, 2500)

    // Calculate BPM over intervals as user taps
    if (taps.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1])
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      if (avgInterval > 0) {
        const calculatedBpm = Math.max(30, Math.min(300, Math.round((60000 / avgInterval) * 10) / 10))
        deck.setTrackBpm(calculatedBpm)
      }
    }

    // After 4 full taps, complete sequence
    if (taps.length >= 4) {
      if (tapResetTimerRef.current) window.clearTimeout(tapResetTimerRef.current)
      tapResetTimerRef.current = window.setTimeout(() => {
        taps.length = 0
        setTapCount(0)
      }, 700)
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

      {/* Tap Tempo Button: TAP (shows 4-tap counter: TAP, 1/4, 2/4, 3/4, 4/4) */}
      <button
        type="button"
        onClick={handleTapTempo}
        disabled={!deck.track}
        className={`h-11 min-w-[48px] px-2.5 rounded-md border text-[10.5px] font-bold uppercase tracking-wider flex flex-col items-center justify-center transition-all shadow-sm select-none ${
          tapCount > 0
            ? 'bg-[#222222] border-white text-white shadow-[0_0_8px_rgba(255,255,255,0.35)] scale-[0.97]'
            : 'bg-[#141414] border-[#282828] text-[#666666] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-40'
        }`}
        title={`Deck ${deckId} Tap Tempo — Tap 4 times in rhythm to set BPM`}
      >
        <span>TAP</span>
        {tapCount > 0 && (
          <span className="text-[8px] font-mono font-bold leading-none text-emerald-400 mt-0.5">
            {tapCount}/4
          </span>
        )}
      </button>
    </div>
  )
}
