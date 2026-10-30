import { useEffect, useRef, useState } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { JogWheel } from './JogWheel'
import { Fader } from './Fader'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'
import { useViewportMode } from '@/lib/use-viewport'
import { FADER_CAP_W, KIOSK_FADER_CAP_W } from '@/lib/dj/control-size'
import { ACTIVE, ACTIVE_KEY } from '@/lib/dj/control-state'

interface TraktorDeckProps {
  deck: DeckEngine
  otherDeck: DeckEngine
  deckId: 'A' | 'B'
  side: 'left' | 'right'
  accentColor: string
  onLoadClick?: () => void
}

/**
 * The pitch fader's travel, fixed at ±10 %.
 */
const PITCH_RANGE = 10

export function TraktorDeck({
  deck,
  otherDeck: _otherDeck,
  deckId,
  side,
  accentColor,
  onLoadClick: _onLoadClick,
}: TraktorDeckProps) {
  const { kiosk } = useViewportMode()
  const [, setVer] = useState(0)
  const [activeNudge, setActiveNudge] = useState<-1 | 0 | 1>(0)
  const nudgeIntervalRef = useRef<number | null>(null)

  useEffect(() => {
    const unsub = deck.subscribe(() => setVer(v => v + 1))
    return () => {
      unsub()
      if (nudgeIntervalRef.current) clearInterval(nudgeIntervalRef.current)
      deck.nudge(0)
    }
  }, [deck])

  const handleNudgeStart = (dir: -1 | 1, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {}
    setActiveNudge(dir)
    deck.nudge(dir)

    if (!deck.playing) {
      if (nudgeIntervalRef.current) clearInterval(nudgeIntervalRef.current)
      nudgeIntervalRef.current = window.setInterval(() => {
        deck.nudge(dir)
      }, 100)
    }
  }

  const handleNudgeEnd = (e?: React.PointerEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
    }
    if (nudgeIntervalRef.current) {
      clearInterval(nudgeIntervalRef.current)
      nudgeIntervalRef.current = null
    }
    setActiveNudge(0)
    deck.nudge(0)
  }

  const pitchPercent = (deck.rate - 1) * 100

  // Incremental BPM tempo adjustment
  const stepPitchBpm = (deltaBpm: number) => {
    const ytDeck = youtubeBridge.state[deckId]
    const baseBpm = deck.track?.bpm || (ytDeck.hasVideo ? ytDeck.bpm : 120)
    const currentBpm = deck.effectiveBpm || (ytDeck.hasVideo ? ytDeck.bpm * ytDeck.playbackRate : baseBpm)
    const targetBpm = Math.max(20, Math.min(300, Math.round((currentBpm + deltaBpm) * 10) / 10))
    const newRate = targetBpm / baseBpm
    deck.setRate(newRate)
    youtubeBridge.setPlaybackRate(deckId, newRate)
  }

  // FX state and triggers
  const isEchoActive = deck.fxType === 'echo' && deck.fxWet > 0
  const isReverbActive = deck.fxType === 'reverb' && deck.fxWet > 0

  const toggleEcho = () => {
    if (isEchoActive) {
      deck.setFxWet(0)
    } else {
      deck.setFx('echo')
      deck.setFxWet(0.5)
    }
  }

  const toggleReverb = () => {
    if (isReverbActive) {
      deck.setFxWet(0)
    } else {
      deck.setFx('reverb')
      deck.setFxWet(0.5)
    }
  }

  const triggerBrake = async () => {
    if (!deck.track) return
    void deck.triggerBrake()
  }

  const triggerCutter = async () => {
    if (!deck.track) return
    void deck.triggerCutter()
  }

  const isOuterLeft = side === 'left'

  return (
    <div
      className={`flex items-center ${
        kiosk ? 'gap-2.5' : 'gap-4'
      } h-full select-none shrink-0 ${isOuterLeft ? 'flex-row' : 'flex-row-reverse'}`}
    >
      {/* ================= 1. OUTER EDGE: PITCH FADER SECTION ================= */}
      {/* Mockup layout: [-] button at top, vertical pitch fader in middle, rate readout (+0.0%), [+] button at bottom */}
      <div
        className="flex flex-col items-center justify-between h-full py-2 px-1 shrink-0 bg-[#161616] rounded-md border border-[#282828] select-none w-[64px]"
      >
        {/* Top: Pitch Decrement (-) */}
        <button
          type="button"
          onClick={() => stepPitchBpm(-0.1)}
          disabled={!deck.track}
          className="w-full h-[22px] rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#a0a0a0] hover:text-white active:text-white active:border-zinc-500 active:bg-[#101010] active:shadow-[0_0_8px_rgba(113,113,122,0.35)] flex items-center justify-center transition-all shadow-sm select-none disabled:opacity-20 shrink-0 font-bold text-sm leading-none"
          title="Tempo down (-0.1 BPM)"
          aria-label="Tempo down"
        >
          −
        </button>

        {/* Pitch Fader Slider */}
        <div className="flex-1 flex items-center justify-center my-1">
          <Fader
            orientation="vertical"
            min={1 - PITCH_RANGE / 100}
            max={1 + PITCH_RANGE / 100}
            step={0.0005}
            value={deck.rate}
            defaultValue={1}
            bipolar
            snapCenter
            invert
            ticks={9}
            onValueChange={r => {
              deck.setRate(r)
              youtubeBridge.setPlaybackRate(deckId, r)
            }}
            accentColor={accentColor}
            capWidth={kiosk ? KIOSK_FADER_CAP_W : FADER_CAP_W}
            className={`w-6 ${kiosk ? 'h-[148px]' : 'h-[155px]'}`}
          />
        </div>

        {/* Pitch Rate Readout & Reset to 0%. Positioned above the [+] button */}
        <button
          type="button"
          onClick={() => {
            deck.setRate(1)
            youtubeBridge.setPlaybackRate(deckId, 1)
          }}
          className="w-full h-[18px] text-[9.5px] font-mono font-bold flex items-center justify-center tabular-nums tracking-tight text-[#dcdcdc] hover:text-white hover:underline transition-all select-none"
          title="Click to reset pitch to 0.0%"
        >
          {pitchPercent >= 0 ? `+${pitchPercent.toFixed(1)}%` : `${pitchPercent.toFixed(1)}%`}
        </button>

        {/* Bottom: Pitch Increment (+) */}
        <button
          type="button"
          onClick={() => stepPitchBpm(0.1)}
          disabled={!deck.track}
          className="w-full h-[22px] rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#a0a0a0] hover:text-white active:text-white active:border-zinc-500 active:bg-[#101010] active:shadow-[0_0_8px_rgba(113,113,122,0.35)] flex items-center justify-center transition-all shadow-sm select-none disabled:opacity-20 shrink-0 font-bold text-sm leading-none"
          title="Tempo up (+0.1 BPM)"
          aria-label="Tempo up"
        >
          +
        </button>
      </div>

      {/* ================= 2. CENTER: JOG WHEEL, REV, FLX & NUDGE BUTTONS ================= */}
      <div className="relative flex flex-col items-center justify-center shrink-0">
        {/* REV Button (Top-Left of platter) */}
        <button
          type="button"
          onClick={() => {
            if (deck.track) {
              void deck.triggerBackspin()
            }
          }}
          className={`absolute top-0.5 left-0.5 z-20 ${
            kiosk ? 'w-7 h-7 text-[8.5px]' : 'w-8 h-8 text-[9.5px]'
          } rounded-full border border-[#2a2a2a] bg-[#161616] text-[#9a9a9a] hover:text-white hover:border-[#444444] active:text-white active:border-zinc-500 active:bg-[#101010] font-bold uppercase flex items-center justify-center transition-all shadow-md select-none`}
          title="REV: Reverse / Spinback playback"
        >
          REV
        </button>

        {/* FLX (Flux / Slip) Button (Top-Right of platter) */}
        <button
          type="button"
          onClick={() => deck.toggleFluxMode()}
          className={`absolute top-0.5 right-0.5 z-20 ${
            kiosk ? 'w-7 h-7 text-[8.5px]' : 'w-8 h-8 text-[9.5px]'
          } rounded-full border font-bold uppercase flex items-center justify-center transition-all shadow-md select-none ${
            deck.fluxMode
              ? ACTIVE_KEY
              : 'border-[#2a2a2a] bg-[#161616] text-[#9a9a9a] hover:text-white hover:border-[#444444]'
          }`}
          title={`FLX: Flux / Slip Mode (${deck.fluxMode ? 'ON' : 'OFF'})\nTimeline continues in background during cues, loops and FX, snapping back on release.`}
        >
          FLX
        </button>

        <JogWheel
          deck={deck}
          deckId={deckId}
          size={kiosk ? 216 : 224}
          accentColor={accentColor}
          className="border-[#282828] shadow-xl"
        />

        {/* Pitch Nudge < and > Buttons flanking the bottom corners of the platter, mirroring REV and FLX */}
        <button
          type="button"
          onPointerDown={e => handleNudgeStart(-1, e)}
          onPointerUp={handleNudgeEnd}
          onPointerCancel={handleNudgeEnd}
          disabled={!deck.track}
          className={`absolute bottom-0.5 left-0.5 z-20 ${
            kiosk ? 'w-7 h-7 text-[12px]' : 'w-8 h-8 text-[14px]'
          } rounded-full border font-bold flex items-center justify-center transition-all select-none shadow-md ${
            activeNudge === -1
              ? ACTIVE
              : 'bg-[#161616] text-[#9a9a9a] border-[#2a2a2a] hover:text-white hover:border-[#444444] disabled:opacity-30'
          }`}
          title="Nudge < (Hold to temporarily slow down)"
        >
          &lt;
        </button>

        <button
          type="button"
          onPointerDown={e => handleNudgeStart(1, e)}
          onPointerUp={handleNudgeEnd}
          onPointerCancel={handleNudgeEnd}
          disabled={!deck.track}
          className={`absolute bottom-0.5 right-0.5 z-20 ${
            kiosk ? 'w-7 h-7 text-[12px]' : 'w-8 h-8 text-[14px]'
          } rounded-full border font-bold flex items-center justify-center transition-all select-none shadow-md ${
            activeNudge === 1
              ? ACTIVE
              : 'bg-[#161616] text-[#9a9a9a] border-[#2a2a2a] hover:text-white hover:border-[#444444] disabled:opacity-30'
          }`}
          title="Nudge > (Hold to temporarily speed up)"
        >
          &gt;
        </button>
      </div>

      {/* ================= 3. INNER EDGE: 4 FX BUTTONS (RVRB, ECHO, SCR, BRK) ================= */}
      <div
        className="flex flex-col items-center justify-between h-full py-1 w-[64px] shrink-0 select-none gap-2.5"
        title={`Deck ${deckId} Performance FX`}
      >
        <button
          type="button"
          onClick={toggleReverb}
          className={`w-full flex-1 rounded-[4px] border text-[10.5px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center select-none shadow-sm ${
            isReverbActive
              ? ACTIVE_KEY
              : 'bg-[#181818] text-[#9a9a9a] border-[#282828] hover:text-white hover:border-[#444444]'
          }`}
          title={`Deck ${deckId} Reverb effect`}
        >
          RVRB
        </button>

        <button
          type="button"
          onClick={toggleEcho}
          className={`w-full flex-1 rounded-[4px] border text-[10.5px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center select-none shadow-sm ${
            isEchoActive
              ? ACTIVE_KEY
              : 'bg-[#181818] text-[#9a9a9a] border-[#282828] hover:text-white hover:border-[#444444]'
          }`}
          title={`Deck ${deckId} Echo effect`}
        >
          ECHO
        </button>

        <button
          type="button"
          onClick={triggerCutter}
          className="w-full flex-1 rounded-[4px] border border-[#282828] bg-[#181818] text-[#9a9a9a] hover:text-white hover:border-[#444444] active:text-white active:border-zinc-500 text-[10.5px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center select-none shadow-sm"
          title={`Deck ${deckId} Scratch / Cutter sample`}
        >
          SCR
        </button>

        <button
          type="button"
          onClick={triggerBrake}
          className="w-full flex-1 rounded-[4px] border border-[#282828] bg-[#181818] text-[#9a9a9a] hover:text-white hover:border-[#444444] active:text-white active:border-zinc-500 text-[10.5px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center select-none shadow-sm"
          title={`Deck ${deckId} Vinyl Brake stop effect`}
        >
          BRK
        </button>
      </div>
    </div>
  )
}
