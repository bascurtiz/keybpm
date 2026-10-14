import { useEffect, useRef, useState } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { JogWheel } from './JogWheel'
import { Knob } from './Knob'
import { Fader } from './Fader'
import { shiftCamelot, findKeySyncShift } from '@/lib/camelot'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

interface TraktorDeckProps {
  deck: DeckEngine
  otherDeck: DeckEngine
  deckId: 'A' | 'B'
  side: 'left' | 'right'
  accentColor: string
  onLoadClick?: () => void
}

const PITCH_RANGES = [6, 10, 16, 100]

export function TraktorDeck({
  deck,
  otherDeck,
  deckId,
  side,
  accentColor,
  onLoadClick: _onLoadClick,
}: TraktorDeckProps) {
  const [, setVer] = useState(0)
  const [pitchRangeIdx, setPitchRangeIdx] = useState(1) // Default ±10%
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

  const maxPitch = PITCH_RANGES[pitchRangeIdx]
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

  // Key Sync logic
  const deckBaseCamelot = deck.track?.key?.camelot
  const otherBaseCamelot = otherDeck?.track?.key?.camelot
  const otherEffectiveCamelot = otherBaseCamelot
    ? shiftCamelot(otherBaseCamelot, otherDeck?.keyShift ?? 0)
    : null
  const currentEffectiveCamelot = deckBaseCamelot
    ? shiftCamelot(deckBaseCamelot, deck.keyShift)
    : null

  const optimalSyncShift =
    deckBaseCamelot && otherEffectiveCamelot
      ? findKeySyncShift(deckBaseCamelot, otherEffectiveCamelot)
      : 0
  const isKeySynced = Boolean(
    deckBaseCamelot &&
      otherEffectiveCamelot &&
      (currentEffectiveCamelot === otherEffectiveCamelot || deck.keyShift === optimalSyncShift) &&
      (deck.keyShift !== 0 || deckBaseCamelot === otherEffectiveCamelot)
  )

  const handleKeySync = () => {
    if (!deck.track || !otherDeck?.track || !deckBaseCamelot || !otherEffectiveCamelot) return
    if (isKeySynced && deck.keyShift !== 0) {
      deck.resetKeyShift()
    } else {
      deck.setKeyShift(optimalSyncShift)
    }
  }

  const cyclePitchRange = () => {
    setPitchRangeIdx(i => (i + 1) % PITCH_RANGES.length)
  }

  const isOuterLeft = side === 'left'

  return (
    <div
      className={`flex items-center justify-between w-full h-full px-1 py-1 select-none ${
        isOuterLeft ? 'flex-row' : 'flex-row-reverse'
      }`}
    >
      {/* ================= 1. OUTER EDGE: PITCH FADER SECTION ================= */}
      <div className="flex flex-col items-center justify-between h-full py-1 w-14 shrink-0 bg-[#161616] rounded-md border border-[#282828] px-1">
        {/* Pitch Rate Readout & Reset to 0% */}
        <button
          type="button"
          onClick={() => {
            deck.setRate(1)
            youtubeBridge.setPlaybackRate(deckId, 1)
          }}
          className="text-[9.5px] font-mono font-bold text-[#d4d4d4] hover:text-white tabular-nums tracking-tight transition-colors"
          title="Click to reset pitch to 0.0%"
        >
          {pitchPercent >= 0 ? `+${pitchPercent.toFixed(1)}%` : `${pitchPercent.toFixed(1)}%`}
        </button>

        {/* Pitch Fader Slider */}
        <div className="flex-1 flex items-center justify-center my-1">
          <Fader
            orientation="vertical"
            min={1 - maxPitch / 100}
            max={1 + maxPitch / 100}
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
            className="w-7 h-[140px]"
          />
        </div>

        {/* Pitch Bend Buttons ▲ and ▼ & Range Toggle */}
        <div className="flex flex-col items-center gap-1 w-full">
          <div className="flex items-center justify-center gap-1 w-full">
            <button
              type="button"
              onClick={() => stepPitchBpm(-0.1)}
              className="h-5 flex-1 rounded bg-[#141414] border border-[#282828] text-[10px] font-bold text-[#666666] hover:text-[#d4d4d4] flex items-center justify-center active:border-white active:text-white"
              title="Tempo down (-0.1 BPM)"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => stepPitchBpm(0.1)}
              className="h-5 flex-1 rounded bg-[#141414] border border-[#282828] text-[10px] font-bold text-[#666666] hover:text-[#d4d4d4] flex items-center justify-center active:border-white active:text-white"
              title="Tempo up (+0.1 BPM)"
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={cyclePitchRange}
            className="w-full h-4 rounded bg-[#141414] border border-[#282828] text-[8px] font-mono font-bold text-[#777777] hover:text-[#d4d4d4] flex items-center justify-center tracking-tight"
            title="Cycle Pitch Range (±6%, ±10%, ±16%, ±100%)"
          >
            ±{maxPitch}%
          </button>
        </div>
      </div>

      {/* ================= 2. CENTER: JOG WHEEL & NUDGE BUTTONS ================= */}
      <div className="relative flex items-center justify-center shrink-0">
        <JogWheel
          deck={deck}
          deckId={deckId}
          size={196}
          accentColor={accentColor}
          className="border-[#282828] shadow-xl"
        />

        {/* Nudge Slow Down (−) */}
        <button
          type="button"
          onPointerDown={e => handleNudgeStart(-1, e)}
          onPointerUp={handleNudgeEnd}
          onPointerCancel={handleNudgeEnd}
          disabled={!deck.track}
          className={`absolute bottom-1 left-1.5 z-20 w-6 h-6 rounded-full border text-[13px] font-bold flex items-center justify-center transition-all select-none shadow-md ${
            activeNudge === -1
              ? 'bg-white text-black border-white shadow-[0_0_8px_rgba(255,255,255,0.6)] scale-95'
              : 'bg-[#181818] text-[#888888] border-[#333333] hover:text-white hover:border-[#555555] active:bg-white active:text-black disabled:opacity-30'
          }`}
          title="Nudge − (Hold to temporarily slow down)"
        >
          −
        </button>

        {/* Nudge Speed Up (+) */}
        <button
          type="button"
          onPointerDown={e => handleNudgeStart(1, e)}
          onPointerUp={handleNudgeEnd}
          onPointerCancel={handleNudgeEnd}
          disabled={!deck.track}
          className={`absolute bottom-1 right-1.5 z-20 w-6 h-6 rounded-full border text-[13px] font-bold flex items-center justify-center transition-all select-none shadow-md ${
            activeNudge === 1
              ? 'bg-white text-black border-white shadow-[0_0_8px_rgba(255,255,255,0.6)] scale-95'
              : 'bg-[#181818] text-[#888888] border-[#333333] hover:text-white hover:border-[#555555] active:bg-white active:text-black disabled:opacity-30'
          }`}
          title="Nudge + (Hold to temporarily speed up)"
        >
          +
        </button>
      </div>

      {/* ================= 3. INNER EDGE: KEY ADJUST & HOT CUES ================= */}
      <div
        className="flex flex-col justify-between h-full py-1 w-16 shrink-0 bg-[#161616] rounded-md border border-[#282828] px-1"
        title={`Deck ${deckId} Controls`}
      >
        {/* Key Transpose Section */}
        <div className="flex flex-col items-center" title="Key Transpose (-6 to +6 semitones)">
          <span
            className={`text-[7.5px] font-bold uppercase tracking-wider mb-1 transition-colors ${
              isKeySynced ? 'text-amber-400' : 'text-[#888888]'
            }`}
          >
            KEY
          </span>
          <Knob
            size={40}
            min={-6}
            max={6}
            bipolar
            value={deck.keyShift}
            defaultValue={0}
            onValueChange={v => deck.setKeyShift(Math.round(v))}
            accentColor="#f59e0b"
          />

          {/* Horizontally aligned RESET and SYNC buttons */}
          <div className="flex items-center justify-center gap-[4px] w-full mt-1">
            <button
              type="button"
              onClick={() => deck.resetKeyShift()}
              className="h-[9px] w-6 font-sans text-[7.5px] font-bold leading-none select-none flex items-center justify-center rounded-[2px] transition-colors"
              title="Reset Key Shift"
            >
              <span
                className={
                  deck.keyShift !== 0
                    ? 'text-amber-400 font-bold hover:text-amber-300'
                    : 'text-[#666666] hover:text-[#d4d4d4]'
                }
              >
                {deck.keyShift !== 0
                  ? deck.keyShift > 0
                    ? `+${deck.keyShift}`
                    : `${deck.keyShift}`
                  : 'RESET'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleKeySync}
              disabled={!deck.track || !otherDeck?.track}
              className={`h-[9px] w-6 font-sans text-[7.5px] font-bold leading-none select-none flex items-center justify-center rounded-[2px] transition-colors ${
                isKeySynced
                  ? 'text-amber-400 font-bold hover:text-amber-300'
                  : 'text-[#666666] hover:text-white disabled:opacity-30'
              }`}
              title="Harmonic Key Sync"
            >
              SYNC
            </button>
          </div>
        </div>

        {/* FLUX Mode Toggle Button (Center between Key and Cues) */}
        <div className="flex items-center justify-center w-full my-1">
          <button
            type="button"
            onClick={() => deck.toggleFluxMode()}
            className={`h-[16px] w-full rounded-[3px] border text-[7.5px] font-mono font-bold tracking-wider uppercase flex items-center justify-center transition-all select-none ${
              deck.fluxMode
                ? 'bg-[#141414] text-white border-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title={`FLUX MODE (${deck.fluxMode ? 'ON' : 'OFF'})\nTimeline continues in background during cues, loops and FX, snapping back on release.`}
          >
            FLUX
          </button>
        </div>

        {/* 4 Hot Cue Pads in single vertical column below key elements */}
        <div className="flex flex-col items-center w-full">
          <span className="text-[7.5px] font-bold text-[#888888] uppercase tracking-wider mb-1">
            CUES
          </span>
          <div className="flex flex-col gap-1 w-full">
            {[0, 1, 2, 3].map(i => {
              const cueTime = deck.hotCues[i]
              const hasCue = cueTime !== null
              const isWaiting = deck.waitingCueIndex === i
              return (
                <div key={i} className="relative group/cue w-full">
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
                    onPointerLeave={() => {
                      deck.hotCueUp(i)
                    }}
                    onContextMenu={e => {
                      e.preventDefault()
                      if (hasCue) deck.clearHotCue(i)
                    }}
                    className={`h-[18px] w-full rounded-[3px] border text-[8.5px] font-bold flex items-center justify-center transition-all ${
                      isWaiting
                        ? 'bg-[#222222] border-white text-white animate-pulse'
                        : hasCue
                        ? 'bg-[#141414] border-white text-white shadow-sm'
                        : 'bg-[#141414] border-[#282828] text-[#666666] hover:text-[#d4d4d4] hover:border-[#444444]'
                    }`}
                    title={
                      hasCue
                        ? `Hot Cue ${i + 1} (${cueTime?.toFixed(2)}s) — Right-click, Shift+Click, or click × to clear`
                        : `Set Hot Cue ${i + 1}`
                    }
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
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#333333] hover:bg-red-500 text-white text-[8px] font-bold leading-none flex items-center justify-center opacity-0 group-hover/cue:opacity-100 transition-opacity z-10 shadow"
                      title={`Remove Hot Cue ${i + 1}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
