import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { Fader } from './Fader'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

interface TraktorTransportBarProps {
  engine: AudioEngine
  className?: string
}

/**
 * How many beats an auto-fade takes, cycled by the value chip next to the `<<` / `>>`
 * arrows. Both arrows share one value: the fade is a property of the move, not of the
 * destination, so a left fade and a right fade of the same length is what a DJ expects.
 * Deliberately independent of the 1/2/4/8/16/32 beat *loop* sizes — those are a loop
 * control, and having them silently set the crossfade length made the loop buttons a
 * hidden second job.
 */
const FADE_BEAT_STEPS = [4, 8, 16, 32, 64]

export function TraktorTransportBar({ engine, className = '' }: TraktorTransportBarProps) {
  const deckA = engine.decks.A
  const deckB = engine.decks.B

  const [, setVer] = useState(0)
  useEffect(() => {
    const unE = engine.subscribe(() => {
      setVer(v => v + 1)
      youtubeBridge.syncCrossfade(engine.crossfade, engine.masterVolume)
    })
    const unA = deckA.subscribe(() => setVer(v => v + 1))
    const unB = deckB.subscribe(() => setVer(v => v + 1))
    const unYt = youtubeBridge.subscribe(() => setVer(v => v + 1))
    return () => {
      unE()
      unA()
      unB()
      unYt()
    }
  }, [engine, deckA, deckB])

  const [fadeBeatsIdx, setFadeBeatsIdx] = useState(0)
  const fadeBeats = FADE_BEAT_STEPS[fadeBeatsIdx]
  const cycleFadeBeats = () => setFadeBeatsIdx(i => (i + 1) % FADE_BEAT_STEPS.length)

  /**
   * AUTO arms the crossfader's own arrows: armed, they cross-fade; disarmed, they nudge 5 %.
   * One pair of controls instead of two, because the hand reaching for the fader is already
   * there. It is a latch, not a trigger — nothing moves until an arrow is pressed, so AUTO can
   * be armed at leisure and only lights to say the arrows mean something else now.
   */
  const [autoArmed, setAutoArmed] = useState(false)

  const toggleAuto = () => {
    // Disarming is "back to rest", which has to include stopping a fade still in flight — an
    // armed-then-disarmed bar must never leave the crossfader travelling on its own.
    if (autoArmed) abortAutoFade()
    setAutoArmed(v => !v)
  }

  // Auto-Fade animation state
  const autoFadeRafRef = useRef<number | null>(null)
  const [isFading, setIsFading] = useState<'left' | 'right' | null>(null)

  /** Stop a fade in flight, leaving the crossfader wherever it got to. */
  const abortAutoFade = () => {
    if (autoFadeRafRef.current !== null) {
      cancelAnimationFrame(autoFadeRafRef.current)
      autoFadeRafRef.current = null
    }
    setIsFading(null)
  }

  const triggerAutoFade = (targetDirection: 'left' | 'right') => {
    // Pressing the arrow that is already fading stops it. The crossfader holds its
    // current position rather than completing the move or snapping back, which is
    // where a manual nudge would have left it.
    if (isFading === targetDirection) {
      abortAutoFade()
      return
    }

    if (autoFadeRafRef.current !== null) {
      cancelAnimationFrame(autoFadeRafRef.current)
      autoFadeRafRef.current = null
    }

    const startVal = engine.crossfade
    const targetVal = targetDirection === 'left' ? -1 : 1
    if (Math.abs(startVal - targetVal) < 0.001) {
      setIsFading(null)
      return
    }

    // Duration in seconds: the shared fade length, at the tempo of the deck being
    // faded into when it is playing.
    const relevantDeck = targetDirection === 'left' ? deckA : deckB
    const otherDeck = targetDirection === 'left' ? deckB : deckA
    const activeDeck = relevantDeck.playing ? relevantDeck : otherDeck.playing ? otherDeck : relevantDeck
    const bpm = activeDeck.effectiveBpm || activeDeck.track?.bpm || engine.masterBpm || 128
    const beatSec = 60 / bpm
    const durationMs = Math.max(500, fadeBeats * beatSec * 1000)

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
    abortAutoFade()
    engine.setCrossfade(engine.crossfade + delta)
  }

  /** The crossfader's own `<` / `>` arrows: cross-fade while AUTO is armed, nudge 5 % while not. */
  const pressCrossfadeArrow = (direction: 'left' | 'right') => {
    if (autoArmed) {
      triggerAutoFade(direction)
      return
    }
    nudgeCrossfade(direction === 'left' ? -0.05 : 0.05)
  }

  return (
    <div
      className={`w-full bg-[#161616] border-t border-[#282828] px-3 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-4 select-none ${className}`}
    >
      {/* ================= DECK A TRANSPORT (LEFT) ================= */}
      <div className="flex items-center justify-start">
        <DeckTransport deck={deckA} deckId="A" />
      </div>

      {/* ================= CENTER: AUTO ARMS THE CROSSFADER, FADE LENGTH BESIDE IT ================= */}
      <div className="w-[380px] flex items-center justify-center">
        {/* The crossfader is the only in-flow child, so it stays on the bar's centre line whatever
            the width of the two controls flanking it. They are absolute for exactly that reason:
            AUTO is wider than the length chip, and in flow they would push the fader off-centre —
            the thing the previous layout was rearranged to stop. */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={toggleAuto}
            aria-pressed={autoArmed}
            className={`absolute right-full mr-2 top-1/2 -translate-y-1/2 h-[22px] px-1.5 rounded border text-[8px] font-bold uppercase tracking-wider flex items-center justify-center transition-all ${
              autoArmed
                ? 'bg-[#141414] text-white border-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title={
              autoArmed
                ? `AUTO armed — the crossfader's < / > cross-fade over ${fadeBeats} beats. Click to disarm.`
                : `Arm AUTO: the crossfader's < / > then cross-fade over ${fadeBeats} beats instead of nudging`
            }
          >
            AUTO
          </button>

          <div className="w-[200px] flex items-center justify-between gap-1.5 px-2.5 py-1 bg-[#141414] rounded-lg border border-[#282828]">
            <button
              type="button"
              onClick={() => pressCrossfadeArrow('left')}
              className={`text-xs font-bold rounded px-1 py-0.5 transition-all select-none ${
                isFading === 'left'
                  ? 'bg-[#34d399]/20 text-[#34d399] shadow-[0_0_8px_rgba(52,211,153,0.3)] animate-pulse'
                  : 'text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222]'
              }`}
              title={
                isFading === 'left'
                  ? 'Stop auto-fade'
                  : autoArmed
                    ? `Cross-fade to Deck A over ${fadeBeats} beats`
                    : 'Nudge Crossfader toward Deck A'
              }
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
              onDragChange={v => engine.setCrossfade(v)}
              onValueChange={v => {
                abortAutoFade()
                engine.setCrossfade(v)
              }}
              label="Crossfader"
              className="h-6 w-[140px] max-w-[140px]"
            />

            <button
              type="button"
              onClick={() => pressCrossfadeArrow('right')}
              className={`text-xs font-bold rounded px-1 py-0.5 transition-all select-none ${
                isFading === 'right'
                  ? 'bg-[#a855f7]/20 text-[#a855f7] shadow-[0_0_8px_rgba(168,85,247,0.3)] animate-pulse'
                  : 'text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222]'
              }`}
              title={
                isFading === 'right'
                  ? 'Stop auto-fade'
                  : autoArmed
                    ? `Cross-fade to Deck B over ${fadeBeats} beats`
                    : 'Nudge Crossfader toward Deck B'
              }
            >
              &gt;
            </button>
          </div>

          {/* Shared auto-fade length: click to cycle 4 / 8 / 16 / 32 / 64 beats. */}
          <button
            type="button"
            onClick={cycleFadeBeats}
            aria-label={`Auto-fade length: ${fadeBeats} beats`}
            className="absolute left-full ml-2 top-1/2 -translate-y-1/2 h-[22px] min-w-[34px] px-1.5 rounded border border-[#282828] bg-[#141414] text-[#777777] hover:text-[#d4d4d4] hover:border-[#444444] font-mono text-[11px] font-bold leading-none flex items-center justify-center transition-colors"
            title={`Auto-fade length: ${fadeBeats} beats — click to cycle 4 / 8 / 16 / 32 / 64`}
          >
            {fadeBeats}
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
      // Local beat length at the loop start, so loops stay beat-accurate on a
      // variable-tempo grid instead of assuming one global tempo.
      const start = deck.snapMode ? deck.snapToBeat(deck.position) : deck.position
      const loopLenSeconds = currentBeats * deck.beatLengthAt(start)
      deck.setLoop(start, start + loopLenSeconds)
    }
  }

  const loopHalf = () => {
    const nextIdx = Math.max(0, selectedLoopIdx - 1)
    setSelectedLoopIdx(nextIdx)
    if (deck.loop && deck.track) {
      const beatLen = deck.beatLengthAt(deck.loop.start)
      const halfBeats = LOOP_BEAT_SIZES[nextIdx]
      const halfLen = halfBeats * beatLen
      deck.setLoop(deck.loop.start, deck.loop.start + halfLen)
    }
  }

  const loopDouble = () => {
    const nextIdx = Math.min(LOOP_BEAT_SIZES.length - 1, selectedLoopIdx + 1)
    setSelectedLoopIdx(nextIdx)
    if (deck.loop && deck.track) {
      const beatLen = deck.beatLengthAt(deck.loop.start)
      const doubleBeats = LOOP_BEAT_SIZES[nextIdx]
      const doubleLen = doubleBeats * beatLen
      deck.setLoop(deck.loop.start, deck.loop.start + doubleLen)
    }
  }

  const ytState = youtubeBridge.state[deckId]
  const hasYt = ytState.hasVideo && !deck.track
  const isPlayingActive = isPlaying || (hasYt && ytState.playing)
  const isDeckReady = Boolean(deck.track || hasYt)

  const handleTogglePlay = () => {
    // Prefer local Web Audio when present; never drive both sources at once.
    if (deck.track) {
      void deck.togglePlay()
      return
    }
    if (hasYt) {
      youtubeBridge.togglePlay(deckId)
    }
  }

  const handleCueDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    if (deck.track) {
      void deck.cueDown()
      return
    }
    if (hasYt) {
      youtubeBridge.seekTo(deckId, ytState.cuePoint)
      youtubeBridge.play(deckId)
    }
  }

  const handleCueUp = (e?: React.PointerEvent) => {
    if (e) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      } catch {
        // ignore
      }
    }
    if (deck.track) {
      deck.cueUp()
      return
    }
    if (hasYt) {
      youtubeBridge.seekTo(deckId, ytState.cuePoint)
      youtubeBridge.pause(deckId)
    }
  }

  const handleCueKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (!e.repeat) {
        if (deck.track) {
          void deck.cueDown()
          return
        }
        if (hasYt) {
          youtubeBridge.seekTo(deckId, ytState.cuePoint)
          youtubeBridge.play(deckId)
        }
      }
    }
  }

  const handleCueKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (deck.track) {
        deck.cueUp()
        return
      }
      if (hasYt) {
        youtubeBridge.seekTo(deckId, ytState.cuePoint)
        youtubeBridge.pause(deckId)
      }
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Play / Pause button matching Traktor */}
      <button
        type="button"
        onClick={handleTogglePlay}
        disabled={!isDeckReady}
        className={`h-11 w-14 rounded-md border flex items-center justify-center transition-all shadow-sm select-none ${
          isPlayingActive
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
        onPointerDown={handleCueDown}
        onPointerUp={handleCueUp}
        onPointerCancel={handleCueUp}
        onKeyDown={handleCueKeyDown}
        onKeyUp={handleCueKeyUp}
        onClick={e => e.preventDefault()}
        onContextMenu={e => e.preventDefault()}
        disabled={!isDeckReady}
        className={`h-11 px-4 rounded-md border text-xs font-bold uppercase tracking-wider flex items-center justify-center transition-all shadow-sm select-none ${
          deck.cuePreviewing
            ? 'bg-amber-500/30 border-amber-400 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
            : isPlayingActive
            ? 'bg-[#141414] border-[#282828] text-[#555555] hover:text-[#d4d4d4] hover:border-[#444444]'
            : 'bg-[#161616] border-[#383838] text-amber-400/90 hover:text-amber-300 hover:border-amber-500/60'
        } disabled:opacity-40`}
        title={`Deck ${deckId} Cue (Hold to preview, release to snap back)`}
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
