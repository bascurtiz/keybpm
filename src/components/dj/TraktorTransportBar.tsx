import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { Fader } from './Fader'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'
import { useViewportMode } from '@/lib/use-viewport'
import { FADER_CAP_W, KIOSK_FADER_CAP_W } from '@/lib/dj/control-size'
import { ACTIVE_KEY, ACTIVE_PLAY } from '@/lib/dj/control-state'

interface TraktorTransportBarProps {
  engine: AudioEngine
  className?: string
}

const FADE_BEAT_STEPS = [4, 8, 16, 32, 64]
const BASS_SWAP_CUT_DB = -12
const BASS_SWAP_FLAT_DB = 0
const BASS_SWAP_FROM = 0.25
const BASS_SWAP_TO = 0.75

const LOOP_PRESETS = [0.25, 0.5, 1, 2, 4, 8] as const

export function TraktorTransportBar({ engine, className = '' }: TraktorTransportBarProps) {
  const { kiosk } = useViewportMode()
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

  const [fadeBeatsIdx, setFadeBeatsIdx] = useState(FADE_BEAT_STEPS.indexOf(64))
  const fadeBeats = FADE_BEAT_STEPS[fadeBeatsIdx]
  const cycleFadeBeats = () => setFadeBeatsIdx(i => (i + 1) % FADE_BEAT_STEPS.length)

  const [autoArmed, setAutoArmed] = useState(false)
  const autoFadeRafRef = useRef<number | null>(null)
  const [isFading, setIsFading] = useState<'left' | 'right' | null>(null)
  const [remainingFadeBeats, setRemainingFadeBeats] = useState<number | null>(null)

  const toggleAuto = () => {
    if (autoArmed) abortAutoFade()
    setAutoArmed(v => !v)
  }

  const abortAutoFade = () => {
    if (autoFadeRafRef.current !== null) {
      cancelAnimationFrame(autoFadeRafRef.current)
      autoFadeRafRef.current = null
    }
    setIsFading(null)
    setRemainingFadeBeats(null)
  }

  const triggerAutoFade = (targetDirection: 'left' | 'right') => {
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
      setRemainingFadeBeats(null)
      return
    }

    const relevantDeck = targetDirection === 'left' ? deckA : deckB
    const otherDeck = targetDirection === 'left' ? deckB : deckA
    const activeDeck = relevantDeck.playing ? relevantDeck : otherDeck.playing ? otherDeck : relevantDeck
    const bpm = activeDeck.effectiveBpm || activeDeck.track?.bpm || engine.masterBpm || 128
    const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 128
    const beatSec = 60 / safeBpm
    const durationMs = Math.max(500, fadeBeats * beatSec * 1000)

    // If incoming deck has a track loaded but is paused, start it playing so music transitions seamlessly
    if (relevantDeck.track && !relevantDeck.playing) {
      void relevantDeck.play()
    }

    const outgoingLowStart = otherDeck.eqLowGain

    // Pre-cut incoming deck bass so when crossfader starts bleeding it in,
    // its kick/bass doesn't clash with the currently active outgoing deck
    relevantDeck.setEqLow(BASS_SWAP_CUT_DB)

    const startTime = performance.now()
    setIsFading(targetDirection)
    setRemainingFadeBeats(fadeBeats)

    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / durationMs)
      const currentVal = startVal + (targetVal - startVal) * progress
      engine.setCrossfade(currentVal)

      // Live remaining beat countdown
      const beatsLeft = Math.max(0, Math.ceil(fadeBeats * (1 - progress)))
      setRemainingFadeBeats(beatsLeft)

      // Smart Bass Swap EQ Curve
      if (progress <= BASS_SWAP_FROM) {
        relevantDeck.setEqLow(BASS_SWAP_CUT_DB)
        otherDeck.setEqLow(outgoingLowStart)
      } else if (progress >= BASS_SWAP_TO) {
        relevantDeck.setEqLow(BASS_SWAP_FLAT_DB)
        otherDeck.setEqLow(BASS_SWAP_CUT_DB)
      } else {
        const swap = (progress - BASS_SWAP_FROM) / (BASS_SWAP_TO - BASS_SWAP_FROM)
        const easeSwap = 0.5 - 0.5 * Math.cos(swap * Math.PI)
        relevantDeck.setEqLow(BASS_SWAP_CUT_DB + (BASS_SWAP_FLAT_DB - BASS_SWAP_CUT_DB) * easeSwap)
        otherDeck.setEqLow(outgoingLowStart + (BASS_SWAP_CUT_DB - outgoingLowStart) * easeSwap)
      }

      if (progress < 1) {
        autoFadeRafRef.current = requestAnimationFrame(step)
      } else {
        engine.setCrossfade(targetVal)
        relevantDeck.setEqLow(BASS_SWAP_FLAT_DB)
        otherDeck.setEqLow(BASS_SWAP_CUT_DB)
        autoFadeRafRef.current = null
        setIsFading(null)
        setRemainingFadeBeats(null)
      }
    }

    autoFadeRafRef.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    return () => {
      if (autoFadeRafRef.current) cancelAnimationFrame(autoFadeRafRef.current)
    }
  }, [])

  const pressCrossfadeArrow = (direction: 'left' | 'right') => {
    if (isFading !== null) {
      abortAutoFade()
      return
    }

    let effectiveDirection = direction
    if (direction === 'left' && engine.crossfade <= -0.95) {
      effectiveDirection = 'right'
    } else if (direction === 'right' && engine.crossfade >= 0.95) {
      effectiveDirection = 'left'
    }

    triggerAutoFade(effectiveDirection)
  }

  return (
    <div
      className={`w-full bg-[#161616] border-t border-[#282828] px-3 py-2 flex flex-col gap-2 select-none ${className}`}
    >
      {/* ================= ROW 1: LOOP SIZE QUICK-SELECT, BEATJUMP, 64 FADE LENGTH ================= */}
      <div className="flex items-center justify-between w-full h-[32px]">
        {/* Deck A Loop & Move strip */}
        <DeckLoopRow deck={deckA} accentColor="#34d399" />

        {/* Center: 64 Auto-fade Beat Length / Master cycle / Live countdown */}
        <div className="flex items-center justify-center shrink-0 px-2">
          <button
            type="button"
            onClick={() => {
              if (isFading !== null) {
                abortAutoFade()
              } else {
                cycleFadeBeats()
              }
            }}
            onContextMenu={e => {
              e.preventDefault()
              toggleAuto()
            }}
            aria-label={
              isFading !== null
                ? `Auto-fading: ${remainingFadeBeats ?? fadeBeats} beats remaining (click to cancel)`
                : `Auto-fade length: ${fadeBeats} beats`
            }
            className={`h-[28px] px-4 rounded-[3px] border font-mono text-xs font-bold leading-none flex items-center justify-center transition-all select-none ${
              isFading === 'left'
                ? 'border-emerald-500 bg-emerald-950/60 text-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.35)] animate-pulse'
                : isFading === 'right'
                ? 'border-purple-500 bg-purple-950/60 text-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.35)] animate-pulse'
                : autoArmed
                ? ACTIVE_KEY
                : 'border-[#282828] bg-[#101010] text-[#dcdcdc] hover:text-white hover:border-[#444444]'
            }`}
            title={
              isFading !== null
                ? `Auto-fading: ${remainingFadeBeats ?? fadeBeats} beats remaining (click to cancel)`
                : `Auto-fade length: ${fadeBeats} beats (click to cycle, right-click for AUTO mode)`
            }
          >
            {remainingFadeBeats !== null ? remainingFadeBeats : fadeBeats}
          </button>
        </div>

        {/* Deck B Loop & Move strip */}
        <DeckLoopRow deck={deckB} accentColor="#a855f7" />
      </div>

      {/* ================= ROW 2: MAIN TRANSPORT (PLAY, CUE, SYNC, TAP, HOTCUES 1-4) & CROSSFADER ================= */}
      <div className="flex items-center justify-between w-full h-[42px]">
        {/* Deck A Transport & Hot Cues */}
        <DeckMainTransport deck={deckA} otherDeck={deckB} deckId="A" accentColor="#34d399" />

        {/* Center: Crossfader with left and right chevrons */}
        <div className="flex items-center justify-center gap-1.5 shrink-0 px-2">
          <button
            type="button"
            onClick={() => pressCrossfadeArrow('left')}
            className={`w-8 h-[36px] rounded flex items-center justify-center transition-all select-none border font-bold text-sm ${
              isFading === 'left'
                ? 'border-emerald-500 bg-emerald-950/60 text-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)] animate-pulse'
                : 'border-[#282828] bg-[#141414] text-[#888888] hover:text-white hover:border-[#444444] active:bg-[#101010]'
            }`}
            title={isFading === 'left' ? 'Click to stop auto-fade' : 'Auto-transition toward Deck A'}
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
            onDragChange={v => {
              abortAutoFade()
              engine.setCrossfade(v)
            }}
            onValueChange={v => {
              abortAutoFade()
              engine.setCrossfade(v)
            }}
            label="Crossfader"
            capWidth={kiosk ? KIOSK_FADER_CAP_W : FADER_CAP_W}
            className="h-6 w-[140px] max-w-[140px]"
          />

          <button
            type="button"
            onClick={() => pressCrossfadeArrow('right')}
            className={`w-8 h-[36px] rounded flex items-center justify-center transition-all select-none border font-bold text-sm ${
              isFading === 'right'
                ? 'border-purple-500 bg-purple-950/60 text-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.4)] animate-pulse'
                : 'border-[#282828] bg-[#141414] text-[#888888] hover:text-white hover:border-[#444444] active:bg-[#101010]'
            }`}
            title={isFading === 'right' ? 'Click to stop auto-fade' : 'Auto-transition toward Deck B'}
          >
            &gt;
          </button>
        </div>

        {/* Deck B Transport & Hot Cues */}
        <DeckMainTransport deck={deckB} otherDeck={deckA} deckId="B" accentColor="#a855f7" />
      </div>
    </div>
  )
}

function DeckLoopRow({ deck, accentColor }: { deck: DeckEngine; accentColor: string }) {
  const [mode, setMode] = useState<'loop' | 'move'>('loop')
  const [moveBeats, setMoveBeats] = useState<number>(4)
  const isLoopActive = Boolean(deck.loop)

  const activeLoopBeats = isLoopActive && deck.loop && deck.track
    ? Math.round(((deck.loop.end - deck.loop.start) / deck.beatLengthAt(deck.loop.start)) * 4) / 4
    : null

  // --- Handlers for LOOP mode ---
  const handleLoopPreset = (beats: number) => {
    if (!deck.track) return
    if (activeLoopBeats === beats) {
      deck.exitLoop()
      return
    }
    const start = deck.snapMode ? deck.snapToBeat(deck.position) : deck.position
    const len = beats * deck.beatLengthAt(start)
    deck.setLoop(start, start + len)
  }

  const handleLoopHalve = () => {
    if (!deck.track) return
    if (deck.loop) {
      const start = deck.loop.start
      const len = (deck.loop.end - start) / 2
      deck.setLoop(start, start + len)
    } else {
      const start = deck.snapMode ? deck.snapToBeat(deck.position) : deck.position
      deck.setLoop(start, start + 4 * deck.beatLengthAt(start))
    }
  }

  const handleLoopDouble = () => {
    if (!deck.track) return
    if (deck.loop) {
      const start = deck.loop.start
      const len = (deck.loop.end - start) * 2
      deck.setLoop(start, start + len)
    } else {
      const start = deck.snapMode ? deck.snapToBeat(deck.position) : deck.position
      deck.setLoop(start, start + 8 * deck.beatLengthAt(start))
    }
  }

  // --- Handlers for MOVE mode ---
  const handleMovePreset = (beats: number) => {
    setMoveBeats(beats)
  }

  const handleMoveHalve = () => {
    const curIdx = LOOP_PRESETS.indexOf(moveBeats as (typeof LOOP_PRESETS)[number])
    const nextIdx = curIdx > 0 ? curIdx - 1 : 0
    setMoveBeats(LOOP_PRESETS[nextIdx])
  }

  const handleMoveDouble = () => {
    const curIdx = LOOP_PRESETS.indexOf(moveBeats as (typeof LOOP_PRESETS)[number])
    const nextIdx = curIdx >= 0 && curIdx < LOOP_PRESETS.length - 1 ? curIdx + 1 : LOOP_PRESETS.length - 1
    setMoveBeats(LOOP_PRESETS[nextIdx])
  }

  // --- Generic navigation arrows (← / →) ---
  const handleNavArrow = (direction: -1 | 1) => {
    if (!deck.track) return
    if (mode === 'move') {
      // MOVE mode: beat jump playhead (and running loop if active) by moveBeats
      const step = moveBeats * deck.beatLengthAt(deck.position)
      deck.movePlayhead(direction * step)
    } else {
      // LOOP mode: shift running loop by 1 loop length (or by 4 beats if no loop)
      const step = (activeLoopBeats || 4) * deck.beatLengthAt(deck.position)
      deck.movePlayhead(direction * step)
    }
  }

  const onHalve = mode === 'move' ? handleMoveHalve : handleLoopHalve
  const onDouble = mode === 'move' ? handleMoveDouble : handleLoopDouble

  return (
    <div className="flex items-center gap-1.5 shrink-0 h-full">
      {/* Dynamic strip: acts as LOOP controls or MOVE controls based on selected mode */}
      <div className="flex items-center rounded border border-[#282828] bg-[#141414] overflow-hidden h-[28px]">
        <button
          type="button"
          onClick={onHalve}
          disabled={!deck.track}
          className="w-[26px] h-full flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] text-[11px] font-bold border-r border-[#282828] transition-colors disabled:opacity-20"
          title={mode === 'move' ? `Halve jump distance (current: ${moveBeats} beats)` : 'Halve loop length (÷2)'}
        >
          &lt;
        </button>

        {LOOP_PRESETS.map(beats => {
          const isLoopSelected = mode === 'loop' && activeLoopBeats === beats
          const isMoveSelected = mode === 'move' && moveBeats === beats
          const label = beats === 0.25 ? '1/4' : beats === 0.5 ? '1/2' : String(beats)

          let btnStyle: React.CSSProperties | undefined
          if (isLoopSelected) {
            btnStyle = { backgroundColor: accentColor, color: '#000000' }
          } else if (isMoveSelected) {
            btnStyle = { backgroundColor: `${accentColor}28`, color: accentColor, borderColor: accentColor }
          }

          return (
            <button
              key={beats}
              type="button"
              onClick={() => (mode === 'move' ? handleMovePreset(beats) : handleLoopPreset(beats))}
              disabled={!deck.track}
              style={btnStyle}
              className={`w-[34px] h-full flex items-center justify-center font-mono text-[10.5px] font-bold border-r border-[#282828] transition-all disabled:opacity-20 ${
                isLoopSelected
                  ? 'font-extrabold shadow-inner'
                  : isMoveSelected
                    ? 'font-extrabold shadow-sm'
                    : 'text-[#888888] hover:text-white hover:bg-[#1a1a1a]'
              }`}
              title={
                mode === 'move'
                  ? `Set jump distance: ${label} beat${beats === 1 ? '' : 's'}`
                  : `Loop ${label} beat${beats === 1 ? '' : 's'}`
              }
            >
              {label}
            </button>
          )
        })}

        <button
          type="button"
          onClick={onDouble}
          disabled={!deck.track}
          className="w-[26px] h-full flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] text-[11px] font-bold transition-colors disabled:opacity-20"
          title={mode === 'move' ? `Double jump distance (current: ${moveBeats} beats)` : 'Double loop length (×2)'}
        >
          &gt;
        </button>
      </div>

      {/* Beat jump / Loop shift arrows: [←] [→] */}
      <div className="flex items-center rounded border border-[#282828] bg-[#141414] overflow-hidden h-[28px]">
        <button
          type="button"
          onClick={() => handleNavArrow(-1)}
          disabled={!deck.track}
          className="w-[28px] h-full flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] text-[13px] font-bold border-r border-[#282828] transition-colors disabled:opacity-20"
          title={
            mode === 'move'
              ? `Jump backward ${moveBeats} beat${moveBeats === 1 ? '' : 's'}`
              : `Shift loop backward (${activeLoopBeats || 4} beats)`
          }
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => handleNavArrow(1)}
          disabled={!deck.track}
          className="w-[28px] h-full flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] text-[13px] font-bold transition-colors disabled:opacity-20"
          title={
            mode === 'move'
              ? `Jump forward ${moveBeats} beat${moveBeats === 1 ? '' : 's'}`
              : `Shift loop forward (${activeLoopBeats || 4} beats)`
          }
        >
          →
        </button>
      </div>

      {/* Separate, dedicated LOOP and MOVE selector buttons */}
      <div className="flex items-center gap-1 ml-0.5">
        <button
          type="button"
          onClick={() => {
            setMode('loop')
            if (mode === 'loop' && deck.track) {
              if (deck.loop) deck.exitLoop()
              else handleLoopPreset(activeLoopBeats || 4)
            }
          }}
          className={`h-[28px] px-2.5 rounded-[3px] border text-[9.5px] font-extrabold tracking-wider uppercase leading-none transition-all flex items-center justify-center select-none shadow-sm ${
            mode === 'loop'
              ? isLoopActive
                ? `${ACTIVE_KEY} shadow-[0_0_8px_rgba(52,211,153,0.3)]`
                : 'bg-[#222222] text-white border-zinc-400'
              : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-white hover:border-[#444444]'
          }`}
          title={
            mode === 'loop'
              ? isLoopActive
                ? 'LOOP active — click to exit loop'
                : 'LOOP mode active — click to engage loop'
              : 'Switch strip to LOOP mode'
          }
        >
          {isLoopActive && (
            <span
              className="w-1.5 h-1.5 rounded-full mr-1 animate-pulse"
              style={{ backgroundColor: accentColor }}
            />
          )}
          LOOP
        </button>

        <button
          type="button"
          onClick={() => setMode('move')}
          className={`h-[28px] px-2.5 rounded-[3px] border text-[9.5px] font-extrabold tracking-wider uppercase leading-none transition-all flex items-center justify-center select-none shadow-sm ${
            mode === 'move'
              ? 'bg-[#222222] text-amber-400 border-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
              : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-white hover:border-[#444444]'
          }`}
          title={`Switch strip to MOVE (Beat Jump) mode — current step: ${moveBeats} beats`}
        >
          MOVE
        </button>
      </div>
    </div>
  )
}

function DeckMainTransport({
  deck,
  otherDeck,
  deckId,
  accentColor,
}: {
  deck: DeckEngine
  otherDeck: DeckEngine
  deckId: 'A' | 'B'
  accentColor: string
}) {
  const ytState = youtubeBridge.state[deckId]
  const hasYt = ytState.hasVideo && !deck.track
  const isPlayingActive = deck.playing || (hasYt && ytState.playing)
  const isDeckReady = Boolean(deck.track || hasYt)

  const [tapCount, setTapCount] = useState(0)
  const tapTimesRef = useRef<number[]>([])
  const tapTimerRef = useRef<number | null>(null)

  const handleTogglePlay = () => {
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
    } catch {}
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
      } catch {}
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

  const handleTapTempo = () => {
    if (!deck.track) return
    const now = performance.now()
    const taps = tapTimesRef.current
    if (taps.length > 0 && now - taps[taps.length - 1] > 2500) taps.length = 0
    taps.push(now)
    if (taps.length > 8) taps.shift()
    setTapCount(taps.length)

    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current)
    tapTimerRef.current = window.setTimeout(() => {
      taps.length = 0
      setTapCount(0)
    }, 2500)

    if (taps.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      if (avg > 0) {
        const bpm = Math.max(30, Math.min(300, Math.round((60000 / avg) * 10) / 10))
        deck.setTrackBpm(bpm)
      }
    }
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0 h-full">
      {/* PLAY Button */}
      <button
        type="button"
        onClick={handleTogglePlay}
        disabled={!isDeckReady}
        className={`w-[68px] h-[36px] rounded-[3px] border flex items-center justify-center transition-all select-none font-bold text-lg ${
          isPlayingActive
            ? ACTIVE_PLAY
            : 'bg-[#181818] text-[#a8a8a8] border-[#2c2c2c] hover:text-white hover:border-[#444444] disabled:opacity-20'
        }`}
        title={`Deck ${deckId} Play / Pause`}
      >
        ▶
      </button>

      {/* CUE Button */}
      <button
        type="button"
        onPointerDown={handleCueDown}
        onPointerUp={handleCueUp}
        onPointerCancel={handleCueUp}
        disabled={!isDeckReady}
        className={`w-[46px] h-[36px] rounded-[3px] border flex items-center justify-center text-[11px] font-bold uppercase tracking-wider transition-all select-none ${
          deck.cuePreviewing
            ? ACTIVE_KEY
            : 'bg-[#181818] text-[#a8a8a8] border-[#2c2c2c] hover:text-white hover:border-[#444444] disabled:opacity-20'
        }`}
        title={`Deck ${deckId} Cue`}
      >
        CUE
      </button>

      {/* SYNC Button */}
      <button
        type="button"
        onClick={() => deck.syncTo(otherDeck)}
        disabled={!deck.track || !otherDeck?.track}
        className={`w-[46px] h-[36px] rounded-[3px] border text-[10.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center select-none ${
          deck.syncLocked
            ? ACTIVE_KEY
            : 'bg-[#181818] text-[#a8a8a8] border-[#2c2c2c] hover:text-white hover:border-[#444444] disabled:opacity-20'
        }`}
        title={`Deck ${deckId} Sync tempo`}
      >
        SYNC
      </button>

      {/* TAP Button */}
      <button
        type="button"
        onClick={handleTapTempo}
        disabled={!deck.track}
        className={`w-[46px] h-[36px] rounded-[3px] border text-[10.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center select-none ${
          tapCount > 0
            ? ACTIVE_KEY
            : 'bg-[#181818] text-[#a8a8a8] border-[#2c2c2c] hover:text-white hover:border-[#444444] disabled:opacity-20'
        }`}
        title={`Deck ${deckId} Tap tempo`}
      >
        {tapCount > 0 ? `${((tapCount - 1) % 4) + 1}/4` : 'TAP'}
      </button>

      {/* HOT CUE PADS: 1, 2, 3, 4 */}
      <div className="flex items-center gap-1.5 ml-1">
        {[0, 1, 2, 3].map(i => {
          const cueTime = deck.hotCues[i]
          const hasCue = cueTime !== null
          return (
            <div key={i} className="relative group/cue">
              <button
                type="button"
                onPointerDown={e => {
                  if (e.button !== 0) return
                  if (e.shiftKey) {
                    deck.clearHotCue(i)
                    return
                  }
                  deck.hotCueDown(i)
                }}
                onPointerUp={e => {
                  if (e.button !== 0) return
                  deck.hotCueUp(i)
                }}
                onContextMenu={e => {
                  e.preventDefault()
                  if (hasCue) deck.clearHotCue(i)
                }}
                style={
                  hasCue
                    ? { borderColor: accentColor, color: accentColor, backgroundColor: `${accentColor}18` }
                    : undefined
                }
                className={`w-[46px] h-[36px] rounded-[3px] border font-mono text-xs font-bold flex items-center justify-center transition-all select-none ${
                  hasCue
                    ? 'shadow-sm'
                    : 'bg-[#181818] text-[#a8a8a8] border-[#2c2c2c] hover:text-white hover:border-[#444444]'
                }`}
                title={hasCue ? `Hot Cue ${i + 1} (${cueTime?.toFixed(2)}s) — right-click to clear` : `Set Hot Cue ${i + 1}`}
              >
                {i + 1}
              </button>
              {hasCue && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    deck.clearHotCue(i)
                  }}
                  className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-red-600/90 text-white text-[8.5px] font-bold leading-none hidden group-hover/cue:flex items-center justify-center hover:bg-red-500 shadow-md z-30"
                  title={`Delete Hot Cue ${i + 1}`}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
