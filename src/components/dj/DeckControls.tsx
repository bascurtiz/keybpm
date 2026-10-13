import { useEffect, useRef, useState } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import type { FxType } from '@/lib/dj/types'
import { JogWheel } from './JogWheel'
import { Knob } from './Knob'
import { findKeySyncShift, shiftCamelot } from '@/lib/camelot'

interface DeckControlsProps {
  deck: DeckEngine
  otherDeck?: DeckEngine
  deckId: 'A' | 'B'
  side: 'left' | 'right'
  accentColor: string
  onLoadClick?: () => void
}

const LOOP_OPTIONS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32]
const PITCH_RANGES = [6, 10, 16, 100] as const
const TICK_COUNT = 21 // 0 to 20; 10 is center 0.0%

export function DeckControls({
  deck,
  otherDeck,
  deckId,
  side,
  accentColor,
  onLoadClick,
}: DeckControlsProps) {
  const [, setVer] = useState(0)
  const [selectedLoopIdx, setSelectedLoopIdx] = useState(6) // default to 8 bars matching mockup < 8 >
  const [showFxMenu, setShowFxMenu] = useState(false)
  const [pitchRangeIdx, setPitchRangeIdx] = useState(1) // default ±10%
  const [pitchBendActive, setPitchBendActive] = useState<'slow' | 'fast' | null>(null)

  // 3-band EQ state
  const [high, setHigh] = useState(0)
  const [mid, setMid] = useState(0)
  const [low, setLow] = useState(0)

  const preKillHigh = useRef(0)
  const preKillMid = useRef(0)
  const preKillLow = useRef(0)

  const toggleKillHigh = () => {
    if (high <= -23) {
      const target = preKillHigh.current <= -23 ? 0 : preKillHigh.current
      setHigh(target)
      deck.setEqHigh(target)
    } else {
      preKillHigh.current = high
      setHigh(-24)
      deck.setEqHigh(-24)
    }
  }

  const toggleKillMid = () => {
    if (mid <= -23) {
      const target = preKillMid.current <= -23 ? 0 : preKillMid.current
      setMid(target)
      deck.setEqMid(target)
    } else {
      preKillMid.current = mid
      setMid(-24)
      deck.setEqMid(-24)
    }
  }

  const toggleKillLow = () => {
    if (low <= -23) {
      const target = preKillLow.current <= -23 ? 0 : preKillLow.current
      setLow(target)
      deck.setEqLow(target)
    } else {
      preKillLow.current = low
      setLow(-24)
      deck.setEqLow(-24)
    }
  }

  const pitchTrackRef = useRef<HTMLDivElement>(null)
  const isDraggingFader = useRef(false)
  const pitchBendSavedRate = useRef<number | null>(null)

  useEffect(() => {
    const unsub = deck.subscribe(() => setVer(v => v + 1))
    return () => {
      unsub()
    }
  }, [deck])

  const pitchPercent = (deck.rate - 1) * 100
  const isPlaying = deck.playing
  const currentLoopBars = LOOP_OPTIONS[selectedLoopIdx]
  const maxPitch = PITCH_RANGES[pitchRangeIdx]
  const isSynced = Boolean(otherDeck?.track && deck.track && Math.abs((deck.effectiveBpm ?? 0) - (otherDeck.effectiveBpm ?? 0)) < 0.05)
  const isCueActive = !isPlaying && Boolean(deck.track)

  // Key Sync logic: harmonizes current deck with other deck's effective key
  const deckBaseCamelot = deck.track?.key?.camelot
  const otherBaseCamelot = otherDeck?.track?.key?.camelot
  const otherEffectiveCamelot = otherBaseCamelot ? shiftCamelot(otherBaseCamelot, otherDeck?.keyShift ?? 0) : null
  const currentEffectiveCamelot = deckBaseCamelot ? shiftCamelot(deckBaseCamelot, deck.keyShift) : null

  const optimalSyncShift = deckBaseCamelot && otherEffectiveCamelot ? findKeySyncShift(deckBaseCamelot, otherEffectiveCamelot) : 0
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

  const keySyncTitle = !deck.track
    ? 'Key Sync (Load track to enable)'
    : !otherDeck?.track
      ? 'Key Sync (Load track on other deck to sync)'
      : isKeySynced
        ? `Key Synced to Deck ${deckId === 'A' ? 'B' : 'A'} (${otherEffectiveCamelot}) — Click to reset`
        : `Key Sync: Harmonize with Deck ${deckId === 'A' ? 'B' : 'A'} (${otherEffectiveCamelot})`

  const getLedButtonStyle = (active: boolean, customColor?: string): React.CSSProperties | undefined => {
    if (!active) return undefined
    const col = customColor || accentColor
    return {
      borderColor: col,
      backgroundColor: `${col}26`, // 15% opacity tint matching Key Lock design
      color: col,
    }
  }

  const adjustBpm = (deltaBpm: number) => {
    const baseBpm = deck.track?.bpm || 120
    const currentBpm = baseBpm * deck.rate
    const targetBpm = currentBpm + deltaBpm
    deck.setRate(targetBpm / baseBpm)
  }

  const handlePitchBendDown = (delta: number) => {
    if (!deck.track) return
    pitchBendSavedRate.current = deck.rate
    setPitchBendActive(delta < 0 ? 'slow' : 'fast')
    deck.setRate(deck.rate + delta)
  }

  const handlePitchBendUp = () => {
    if (pitchBendSavedRate.current !== null) {
      deck.setRate(pitchBendSavedRate.current)
      pitchBendSavedRate.current = null
    }
    setPitchBendActive(null)
  }

  const updatePitchFromPointer = (clientY: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const fraction = (clientY - rect.top) / rect.height // 0 at top, 1 at bottom
    const clamped = Math.max(0, Math.min(1, fraction))
    // In standard DJ gear: top is - (slower), bottom is + (faster)
    // fraction 0.5 is 0.0%
    let newPitch = (clamped - 0.5) * 2 * maxPitch
    // Detent snap: snap to 0 within ±0.15%
    if (Math.abs(newPitch) < 0.15) newPitch = 0
    deck.setRate(1 + Math.round(newPitch * 10) / 1000)
  }

  const handleFaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!deck.track) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    isDraggingFader.current = true
    updatePitchFromPointer(e.clientY, e.currentTarget)
  }

  const handleFaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingFader.current || !deck.track) return
    updatePitchFromPointer(e.clientY, e.currentTarget)
  }

  const handleFaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingFader.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
  }

  const cycleLoopPrev = () => {
    setSelectedLoopIdx(idx => Math.max(0, idx - 1))
  }

  const cycleLoopNext = () => {
    setSelectedLoopIdx(idx => Math.min(LOOP_OPTIONS.length - 1, idx + 1))
  }

  const toggleLoop = () => {
    if (deck.loop) {
      deck.clearLoop()
    } else {
      deck.setBarLoop(currentLoopBars)
    }
  }

  // Column 1: Pioneer / CDJ Style Pitch & Key Section matching the mockup
  const renderPitchStrip = () => {
    const clampedPitch = Math.max(-maxPitch, Math.min(maxPitch, pitchPercent))
    const faderPositionPct = ((clampedPitch / (2 * maxPitch)) + 0.5) * 100
    const isAtZero = Math.abs(pitchPercent) < 0.1

    return (
      <div className="flex flex-col items-center justify-between h-full w-[80px] py-0.5 select-none shrink-0">
        {/* 1. TOP KEY SECTION */}
        <div className="flex flex-col items-center w-full px-0.5 shrink-0">
          {/* Header rule ── KEY ── */}
          <div className="flex items-center gap-1 w-full px-1 mb-1 select-none">
            <div className="flex-1 h-[1px] bg-[#2a2d33]" />
            <span className="font-sans text-[7.5px] font-bold text-zinc-400 tracking-wider">KEY</span>
            <div className="flex-1 h-[1px] bg-[#2a2d33]" />
          </div>

          <div className="flex items-center justify-center gap-[4px] w-full">
            {/* Left: Rotary Knob + Key Shift Indicator / RESET */}
            <div className="flex flex-col items-center w-6">
              <div className="h-5 w-6 flex items-center justify-center">
                <Knob
                  size={20}
                  min={-6}
                  max={6}
                  bipolar
                  value={deck.keyShift}
                  defaultValue={0}
                  onValueChange={v => deck.setKeyShift(Math.round(v))}
                  disabled={!deck.track}
                  accentColor="#f59e0b"
                  format={v => {
                    const s = Math.round(v)
                    return s === 0 ? '0' : (s > 0 ? `+${s}` : `${s}`)
                  }}
                  label=""
                  className="p-0"
                />
              </div>
              <button
                type="button"
                onClick={() => deck.resetKeyShift()}
                className={`font-sans text-[7.5px] font-bold transition-colors cursor-pointer tracking-wider leading-none mt-1 select-none flex items-center justify-center h-[9px] ${
                  deck.keyShift !== 0 ? 'text-amber-400 hover:text-white' : 'text-[#717582] hover:text-white'
                }`}
                title="Click to reset key shift to 0 st"
              >
                {deck.keyShift !== 0 ? (deck.keyShift > 0 ? `+${deck.keyShift}` : `${deck.keyShift}`) : 'RESET'}
              </button>
            </div>

            {/* Right: Circular note button + SYNC below (horizontally aligned with RESET) */}
            <div className="flex flex-col items-center w-6">
              <div className="h-5 w-6 flex items-center justify-center">
                <button
                  type="button"
                  onClick={handleKeySync}
                  disabled={!deck.track || !otherDeck?.track}
                  className={`h-5 w-5 rounded-full border transition-all flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                    isKeySynced
                      ? 'border-amber-500 bg-amber-500/20 text-amber-400 shadow-sm'
                      : 'border-[#2a2d33] bg-[#161616] text-zinc-500 hover:text-zinc-300 hover:border-zinc-500'
                  }`}
                  title={keySyncTitle}
                >
                  <span className="text-[10px] leading-none select-none">♪</span>
                </button>
              </div>
              <button
                type="button"
                onClick={handleKeySync}
                disabled={!deck.track || !otherDeck?.track}
                className={`font-sans text-[7.5px] font-bold transition-colors cursor-pointer tracking-wider leading-none mt-1 select-none flex items-center justify-center h-[9px] disabled:cursor-not-allowed ${
                  isKeySynced
                    ? 'text-amber-400 hover:text-white'
                    : 'text-[#717582] hover:text-white'
                }`}
                title={keySyncTitle}
              >
                SYNC
              </button>
            </div>
          </div>
        </div>

        {/* 2. MIDDLE PITCH FADER SECTION */}
        <div className="flex-1 w-full flex flex-col items-center justify-center my-0.5 px-0.5 relative">
          {/* Top: ▲ − centered, lights up on hover, click nudges speed -0.1 BPM */}
          <div className="w-full flex justify-center mb-1">
            <button
              type="button"
              onClick={() => adjustBpm(-0.1)}
              disabled={!deck.track}
              className="font-sans text-[8px] font-bold text-zinc-500 hover:text-amber-400 active:scale-95 transition-colors cursor-pointer select-none flex items-center gap-0.5 disabled:opacity-30 disabled:hover:text-zinc-500"
              title="Decrease speed by 0.1 BPM"
            >
              ▲ −
            </button>
          </div>

          {/* Vertical Fader Track Area with Single Centered Scale and 0 Detent LED */}
          <div
            ref={pitchTrackRef}
            onPointerDown={handleFaderPointerDown}
            onPointerMove={handleFaderPointerMove}
            onPointerUp={handleFaderPointerUp}
            onPointerCancel={handleFaderPointerUp}
            onDoubleClick={() => deck.setRate(1)}
            className="relative w-full h-[110px] flex items-center justify-center cursor-pointer touch-none"
            title={`Pitch: ${pitchPercent >= 0 ? '+' : ''}${pitchPercent.toFixed(1)}% (Double-click to reset to 0.0%)`}
          >
            {/* Single centered scale lines container spanning height */}
            <div className="absolute inset-0 flex flex-col justify-between py-1 pointer-events-none">
              {Array.from({ length: TICK_COUNT }).map((_, i) => {
                const isCenter = i === 10
                const isMajor = i % 5 === 0
                return (
                  <div key={i} className="flex items-center justify-center w-full h-[1px] relative">
                    {/* Centered single horizontal tick line */}
                    <div
                      className={`h-[1px] bg-white transition-opacity ${
                        isCenter
                          ? 'w-8 opacity-95'
                          : isMajor
                            ? 'w-6 opacity-80'
                            : 'w-3.5 opacity-35'
                      }`}
                    />

                    {/* Green 0% detent LED to the right of the center line */}
                    {isCenter && (
                      <div
                        className={`absolute left-[calc(50%+18px)] w-1.5 h-1.5 rounded-full -translate-y-1/2 top-1/2 transition-all ${
                          isAtZero
                            ? 'bg-[#22c55e] shadow-[0_0_6px_#22c55e]'
                            : 'bg-[#064e3b]/80 border border-[#065f46]/40'
                        }`}
                        title="0.0% Pitch Center Detent"
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Central Recessed Fader Slot */}
            <div className="w-[5px] h-full bg-[#0a0b0e] border border-[#23252a] rounded-full shadow-inner pointer-events-none" />

            {/* DJ Fader Cap (Matching volume & crossfader caps: w-8 h-4 #58585a slate gray with white indicator) */}
            <div
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-4 rounded-[2px] bg-[#58585a] border border-[#3c3d42] shadow-md flex items-center justify-center cursor-grab active:cursor-grabbing z-20 pointer-events-none"
              style={{ top: `${faderPositionPct}%` }}
            >
              {/* White horizontal indicator stripe */}
              <div className="w-full h-[1.5px] bg-white shadow-sm" />
            </div>
          </div>

          {/* Bottom: ▼ + centered, lights up on hover, click nudges speed +0.1 BPM */}
          <div className="w-full flex justify-center mt-1">
            <button
              type="button"
              onClick={() => adjustBpm(0.1)}
              disabled={!deck.track}
              className="font-sans text-[8px] font-bold text-zinc-500 hover:text-amber-400 active:scale-95 transition-colors cursor-pointer select-none flex items-center gap-0.5 disabled:opacity-30 disabled:hover:text-zinc-500"
              title="Increase speed by 0.1 BPM"
            >
              ▼ +
            </button>
          </div>
        </div>

        {/* 3. PITCH BEND & RANGE SECTION */}
        <div className="flex flex-col gap-1.5 w-full pb-0.5 shrink-0 items-center">
          {/* Row 1: Pitch Bend pill element (aligned with top of 1 2 3 4) + text below */}
          <div className="h-9 flex flex-col items-center justify-start pt-1 w-full">
            {/* Dual button pill capsule for [-] and [+] with amber halo */}
            <div className="flex items-center justify-center gap-1.5 bg-[#141214] border border-amber-500/30 rounded-full px-2 py-0.5 shadow-inner">
              <button
                type="button"
                onPointerDown={() => handlePitchBendDown(-0.04)}
                onPointerUp={handlePitchBendUp}
                onPointerLeave={handlePitchBendUp}
                disabled={!deck.track}
                className={`h-5 w-5 rounded-full border flex items-center justify-center font-sans text-[11px] font-bold leading-none transition-all disabled:opacity-30 select-none ${
                  pitchBendActive === 'slow'
                    ? 'border-amber-400 bg-amber-500/25 text-amber-300'
                    : 'border-amber-500/80 bg-[#16120c] text-amber-400 hover:bg-amber-500/20'
                }`}
                title="Pitch Bend Slow (Hold to nudge tempo down)"
              >
                −
              </button>
              <button
                type="button"
                onPointerDown={() => handlePitchBendDown(0.04)}
                onPointerUp={handlePitchBendUp}
                onPointerLeave={handlePitchBendUp}
                disabled={!deck.track}
                className={`h-5 w-5 rounded-full border flex items-center justify-center font-sans text-[11px] font-bold leading-none transition-all disabled:opacity-30 select-none ${
                  pitchBendActive === 'fast'
                    ? 'border-amber-400 bg-amber-500/25 text-amber-300'
                    : 'border-amber-500/80 bg-[#16120c] text-amber-400 hover:bg-amber-500/20'
                }`}
                title="Pitch Bend Fast (Hold to nudge tempo up)"
              >
                +
              </button>
            </div>
          </div>

          {/* Row 2: Range display element (aligned with top of 8 FX 8) + text below */}
          <div className="h-9 flex flex-col items-center justify-start pt-1 w-full">
            <button
              type="button"
              onClick={() => setPitchRangeIdx(i => (i + 1) % PITCH_RANGES.length)}
              className="h-5 w-[51px] px-2 rounded-[2px] bg-[#161616] border border-[#2a2d33] font-sans text-[10px] font-bold text-zinc-300 tabular-nums hover:text-white hover:border-zinc-500 hover:bg-[#252830] transition-colors flex items-center justify-center tracking-wider leading-none shadow-inner select-none cursor-pointer"
              title={`Active Pitch Range: ±${maxPitch === 100 ? 'WIDE' : `${maxPitch}%`} (Click to toggle)`}
            >
              ±{maxPitch === 100 ? 'WIDE' : `${maxPitch}%`}
            </button>
            <span className="font-sans text-[7.5px] font-bold text-zinc-400 tracking-wider uppercase text-center select-none leading-none mt-1">
              RANGE
            </span>
          </div>
        </div>
      </div>
    )
  }

  // Column 2: EQ Knobs on top (High, Mid, Low) + Transport buttons on bottom (Cue, Play)
  const renderEqAndTransportColumn = () => (
    <div className="flex flex-col items-center justify-between h-full py-0.5 shrink-0 w-[46px]">
      {/* Upper Section: 3 EQ Knobs (High, Mid, Low) grouped closer together */}
      <div className="flex-1 flex flex-col items-center justify-start gap-2 pt-0.5 w-full">
        {/* High (size 40) */}
        <Knob
          size={40}
          variant="dark"
          min={-24}
          max={6}
          value={high}
          defaultValue={0}
          bipolar
          onValueChange={v => {
            setHigh(v)
            deck.setEqHigh(v)
          }}
          label="High"
          labelPlacement="bottom"
          accentColor={accentColor}
          format={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`}
          onDotClick={toggleKillHigh}
          isDotActive={high <= -23}
          dotActiveColor="#ef4444"
          dotTitle={high <= -23 ? 'High Killed (-24dB) — Click dot to restore' : 'High Kill Switch — Click dot to kill band'}
        />

        {/* Mid (size 40) */}
        <Knob
          size={40}
          variant="dark"
          min={-24}
          max={6}
          value={mid}
          defaultValue={0}
          bipolar
          onValueChange={v => {
            setMid(v)
            deck.setEqMid(v)
          }}
          label="Mid"
          labelPlacement="bottom"
          accentColor={accentColor}
          format={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`}
          onDotClick={toggleKillMid}
          isDotActive={mid <= -23}
          dotActiveColor="#ef4444"
          dotTitle={mid <= -23 ? 'Mid Killed (-24dB) — Click dot to restore' : 'Mid Kill Switch — Click dot to kill band'}
        />

        {/* Low (size 40) */}
        <Knob
          size={40}
          variant="dark"
          min={-24}
          max={6}
          value={low}
          defaultValue={0}
          bipolar
          onValueChange={v => {
            setLow(v)
            deck.setEqLow(v)
          }}
          label="Low"
          labelPlacement="bottom"
          accentColor={accentColor}
          format={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`}
          onDotClick={toggleKillLow}
          isDotActive={low <= -23}
          dotActiveColor="#ef4444"
          dotTitle={low <= -23 ? 'Low Killed (-24dB) — Click dot to restore' : 'Low Kill Switch — Click dot to kill band'}
        />
      </div>

      {/* Lower Section: Sync, Cue & Play transport buttons matching height & spacing of Performance rows */}
      <div className="flex flex-col gap-1.5 shrink-0 pb-0.5 items-center w-full">
        {/* SYNC button above Cue button with breathing room */}
        <button
          type="button"
          onClick={() => otherDeck && deck.syncTo(otherDeck)}
          disabled={!deck.track || !otherDeck?.track}
          className={`h-4 w-9 rounded-[2px] font-sans text-[7.5px] font-bold border transition-colors flex items-center justify-center tracking-wider select-none disabled:opacity-30 mb-1.5 ${
            isSynced
              ? 'font-black'
              : 'border-[#2a2d33] bg-[#161616] text-zinc-400 hover:text-white hover:border-zinc-500 hover:bg-[#252830]'
          }`}
          style={getLedButtonStyle(isSynced)}
          title={`Sync Deck ${deckId} tempo to other deck: ${isSynced ? 'SYNCED' : 'OFF'}`}
        >
          SYNC
        </button>

        {/* Cue button (aligned horizontally with Hot Cues 1 2 3 4) */}
        <div className="h-9 flex items-center justify-center">
          <button
            type="button"
            onClick={() => deck.cue()}
            disabled={!deck.track}
            className={`h-9 w-9 rounded-full border text-[11px] font-bold transition-all flex items-center justify-center shrink-0 tracking-tight active:scale-95 disabled:opacity-30 ${
              isCueActive
                ? 'font-extrabold'
                : 'border-[#2a2d33] bg-[#161616] text-zinc-400 hover:text-white hover:border-zinc-500 hover:bg-[#252830]'
            }`}
            style={getLedButtonStyle(isCueActive, '#f59e0b')}
            title="CDJ Cue"
          >
            Cue
          </button>
        </div>

        {/* Play button (aligned horizontally with Loop / FX) */}
        <div className="h-9 flex items-center justify-center">
          <button
            type="button"
            onClick={() => deck.togglePlay()}
            disabled={!deck.track}
            className={`h-9 w-9 rounded-full border text-sm font-bold flex items-center justify-center transition-all active:scale-95 disabled:opacity-30 shrink-0 ${
              isPlaying
                ? 'font-extrabold'
                : 'border-[#2a2d33] bg-[#161616] text-zinc-400 hover:text-white hover:border-zinc-500 hover:bg-[#252830]'
            }`}
            style={getLedButtonStyle(isPlaying)}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="translate-x-0.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )

  // Column 3: Jog Wheel Platter on top + 2-Row Performance Controls on bottom
  const renderPlatterAndControls = () => (
    <div className="flex flex-col items-center justify-between h-full py-0.5 flex-1 min-w-[200px]">
      {/* Enlarged Jog Wheel Platter */}
      <div
        className="flex items-center justify-center flex-1 cursor-pointer py-0.5 w-full"
        onClick={!deck.track ? onLoadClick : undefined}
        title={!deck.track ? `Load track into Deck ${deckId}` : `Deck ${deckId} Platter`}
      >
        <JogWheel deck={deck} size={144} accentColor={accentColor} />
      </div>

      {/* 2-Row Performance Controls */}
      <div className="flex flex-col gap-1.5 w-full pb-0.5">
        {/* Row 1: Hot Cues 1 2 3 4 (aligned with Cue) */}
        <div className="h-9 flex items-center w-full">
          <div className="grid grid-cols-4 gap-1 w-full h-7">
            {[0, 1, 2, 3].map(i => {
              const isSet = deck.hotCues[i] !== null
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => deck.triggerHotCue(i)}
                  onContextMenu={e => {
                    e.preventDefault()
                    deck.clearHotCue(i)
                  }}
                  disabled={!deck.track}
                  className={`h-full w-full rounded-[2px] font-sans text-[10px] font-bold transition-all border flex items-center justify-center ${
                    isSet
                      ? 'font-extrabold'
                      : 'border-[#2a2d33] bg-[#161616] text-zinc-400 hover:text-white hover:border-zinc-500 hover:bg-[#252830]'
                  }`}
                  style={getLedButtonStyle(isSet)}
                  title={isSet ? `Hot Cue ${i + 1} (Right-click to clear)` : `Set Hot Cue ${i + 1}`}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>
        </div>

        {/* Row 2: Loop & FX Controls in 4-column grid matching Row 1 (aligned with Play) */}
        <div className="h-9 flex items-center w-full">
          <div className="grid grid-cols-4 gap-1 w-full h-7">
            {/* Loop length selector < 8 >: col-span-2 */}
            <div className="col-span-2 flex items-center justify-between h-full bg-[#161616] border border-[#2a2d33] rounded-[2px] px-1 gap-1 min-w-0">
              <button
                type="button"
                onClick={cycleLoopPrev}
                className="text-[8px] text-[#8e929b] hover:text-white font-bold px-0.5"
                title="Halve loop"
              >
                &lt;
              </button>
              <span className="font-sans text-[9px] font-bold text-zinc-300 truncate">
                {currentLoopBars >= 1 ? currentLoopBars : `1/${Math.round(1 / currentLoopBars)}`}
              </span>
              <button
                type="button"
                onClick={cycleLoopNext}
                className="text-[8px] text-[#8e929b] hover:text-white font-bold px-0.5"
                title="Double loop"
              >
                &gt;
              </button>
            </div>

            {/* FX button: col-span-1 */}
            <div className="col-span-1 relative h-full">
              <button
                type="button"
                onClick={() => setShowFxMenu(o => !o)}
                className={`w-full h-full rounded-[2px] text-[8px] font-bold border transition-colors flex items-center justify-center ${
                  deck.fxType !== 'off'
                    ? 'font-extrabold'
                    : 'border-[#2a2d33] bg-[#161616] text-zinc-400 hover:text-white hover:border-zinc-500 hover:bg-[#252830]'
                }`}
                style={getLedButtonStyle(deck.fxType !== 'off')}
                title={`Master FX: ${deck.fxType.toUpperCase()}`}
              >
                FX
              </button>

              {showFxMenu && (
                <div className="absolute bottom-full left-0 mb-1 z-30 w-24 bg-[#1C1C1C] border border-[#2a2d33] rounded shadow-xl p-1 flex flex-col gap-0.5">
                  {(['off', 'echo', 'reverb', 'flanger'] as FxType[]).map(fx => (
                    <button
                      key={fx}
                      type="button"
                      onClick={() => {
                        deck.setFx(fx)
                        setShowFxMenu(false)
                      }}
                      className={`px-2 py-1 text-left text-[10px] uppercase font-bold rounded ${
                        deck.fxType === fx ? 'bg-[#252830] text-white' : 'text-[#8e929b] hover:bg-[#161616] hover:text-white'
                      }`}
                    >
                      {fx}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Loop activate button [ ↺ 8 ▲▼ ]: col-span-1 */}
            <div
              className="col-span-1 flex items-center h-full w-full bg-[#161616] border rounded-[2px] overflow-hidden transition-colors"
              style={{ borderColor: deck.loop ? accentColor : '#2a2d33' }}
            >
              <button
                type="button"
                onClick={toggleLoop}
                disabled={!deck.track}
                className={`flex-1 h-full px-0.5 flex items-center justify-center gap-0.5 text-[8px] font-bold transition-all min-w-0 ${
                  deck.loop
                    ? 'font-black'
                    : 'text-zinc-300 hover:text-white hover:bg-[#252830]'
                }`}
                style={getLedButtonStyle(Boolean(deck.loop))}
                title={deck.loop ? 'Exit Loop' : `Activate ${currentLoopBars}-bar Loop`}
              >
                <span>↺</span>
                <span className="truncate">{currentLoopBars >= 1 ? currentLoopBars : `1/${Math.round(1 / currentLoopBars)}`}</span>
              </button>
              <div
                className="flex flex-col border-l w-2.5 h-full shrink-0"
                style={{ borderColor: deck.loop ? `${accentColor}44` : '#2a2d33' }}
              >
                <button
                  type="button"
                  onClick={cycleLoopNext}
                  className="flex-1 flex items-center justify-center text-[6px] text-[#8e929b] hover:text-white leading-none hover:bg-[#252830]"
                  title="Increase loop"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={cycleLoopPrev}
                  className="flex-1 flex items-center justify-center text-[6px] text-[#8e929b] hover:text-white leading-none hover:bg-[#252830]"
                  title="Decrease loop"
                >
                  ▼
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex items-center gap-2.5 h-full select-none">
      {side === 'left' ? (
        <>
          {renderPitchStrip()}
          {renderPlatterAndControls()}
          {renderEqAndTransportColumn()}
        </>
      ) : (
        <>
          {renderEqAndTransportColumn()}
          {renderPlatterAndControls()}
          {renderPitchStrip()}
        </>
      )}
    </div>
  )
}
