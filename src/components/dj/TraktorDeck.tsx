import { useEffect, useRef, useState } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { JogWheel } from './JogWheel'
import { Knob } from './Knob'
import { Fader } from './Fader'
import { shiftCamelot, findKeySyncShift } from '@/lib/camelot'

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
  onLoadClick,
}: TraktorDeckProps) {
  const [, setVer] = useState(0)
  const [pitchRangeIdx, setPitchRangeIdx] = useState(1) // Default ±10%

  useEffect(() => {
    const unsub = deck.subscribe(() => setVer(v => v + 1))
    return () => {
      unsub()
    }
  }, [deck])

  const maxPitch = PITCH_RANGES[pitchRangeIdx]
  const pitchPercent = (deck.rate - 1) * 100

  // Pitch bend temporary nudge
  const pitchBendSavedRate = useRef<number | null>(null)
  const startPitchBend = (delta: number) => {
    if (pitchBendSavedRate.current === null) {
      pitchBendSavedRate.current = deck.rate
    }
    deck.setRate(deck.rate + delta)
  }
  const endPitchBend = () => {
    if (pitchBendSavedRate.current !== null) {
      deck.setRate(pitchBendSavedRate.current)
      pitchBendSavedRate.current = null
    }
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
          onClick={() => deck.setRate(1)}
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
            ticks={9}
            onValueChange={r => deck.setRate(r)}
            accentColor={accentColor}
            className="w-7 h-[140px]"
          />
        </div>

        {/* Pitch Bend Buttons ▲ and ▼ & Range Toggle */}
        <div className="flex flex-col items-center gap-1 w-full">
          <div className="flex items-center justify-center gap-1 w-full">
            <button
              type="button"
              onPointerDown={() => startPitchBend(-0.015)}
              onPointerUp={endPitchBend}
              onPointerLeave={endPitchBend}
              className="h-5 flex-1 rounded bg-[#141414] border border-[#282828] text-[10px] font-bold text-[#666666] hover:text-[#d4d4d4] flex items-center justify-center active:bg-[#333333]"
              title="Pitch bend down (temporary -1.5%)"
            >
              −
            </button>
            <button
              type="button"
              onPointerDown={() => startPitchBend(0.015)}
              onPointerUp={endPitchBend}
              onPointerLeave={endPitchBend}
              className="h-5 flex-1 rounded bg-[#141414] border border-[#282828] text-[10px] font-bold text-[#666666] hover:text-[#d4d4d4] flex items-center justify-center active:bg-[#333333]"
              title="Pitch bend up (temporary +1.5%)"
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

      {/* ================= 2. CENTER: JOG WHEEL ================= */}
      <div
        className="flex items-center justify-center shrink-0"
        onClick={() => {
          if (!deck.track) onLoadClick?.()
        }}
        title={deck.track ? `Deck ${deckId} Jog Wheel` : `Click to load track to Deck ${deckId}`}
      >
        <JogWheel
          deck={deck}
          size={195}
          accentColor={accentColor}
          className="border-[#282828] shadow-xl"
        />
      </div>

      {/* ================= 3. INNER EDGE: KEY ADJUST & HOT CUES ================= */}
      <div
        className="flex flex-col justify-between h-full py-1 w-16 shrink-0 bg-[#161616] rounded-md border border-[#282828] px-1"
        title={`Deck ${deckId} Controls`}
      >
        {/* Key Transpose Section */}
        <div className="flex flex-col items-center" title="Key Transpose (-6 to +6 semitones)">
          <span className="text-[7.5px] font-bold text-[#888888] uppercase tracking-wider mb-1">
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
                    ? 'text-[#d4d4d4] font-bold hover:text-white'
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
                  ? 'text-[#d4d4d4] font-bold hover:text-white'
                  : 'text-[#666666] hover:text-white disabled:opacity-30'
              }`}
              title="Harmonic Key Sync"
            >
              SYNC
            </button>
          </div>
        </div>

        {/* 4 Hot Cue Pads in compact 2x2 grid */}
        <div className="flex flex-col items-center w-full">
          <span className="text-[7.5px] font-bold text-[#888888] uppercase tracking-wider mb-1">
            CUES
          </span>
          <div className="grid grid-cols-2 gap-1 w-full">
            {[0, 1, 2, 3].map(i => {
              const cueTime = deck.hotCues[i]
              const hasCue = cueTime !== null
              return (
                <div key={i} className="relative group/cue">
                  <button
                    type="button"
                    onClick={e => {
                      if (e.shiftKey) deck.clearHotCue(i)
                      else deck.triggerHotCue(i)
                    }}
                    onContextMenu={e => {
                      e.preventDefault()
                      if (hasCue) deck.clearHotCue(i)
                    }}
                    className={`h-6 w-full rounded border text-[10px] font-bold flex items-center justify-center transition-all ${
                      hasCue
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
