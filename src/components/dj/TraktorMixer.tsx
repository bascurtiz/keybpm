import { useEffect, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import { Knob } from './Knob'
import { FilterKnob } from './FilterKnob'
import { Fader } from './Fader'
import { shiftCamelot, findKeySyncShift } from '@/lib/camelot'

interface TraktorMixerProps {
  engine: AudioEngine
  className?: string
}

export function TraktorMixer({ engine, className = '' }: TraktorMixerProps) {
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

  const [gainA, setGainA] = useState(1)
  const [eqHighA, setEqHighA] = useState(0)
  const [eqMidA, setEqMidA] = useState(0)
  const [filterA, setFilterA] = useState(0)
  const [volumeA, setVolumeA] = useState(1)

  const [gainB, setGainB] = useState(1)
  const [eqHighB, setEqHighB] = useState(0)
  const [eqMidB, setEqMidB] = useState(0)
  const [filterB, setFilterB] = useState(0)
  const [volumeB, setVolumeB] = useState(1)

  // Sync states (continuous sync lock)
  const isSyncedA = deckA.syncLocked
  const isSyncedB = deckB.syncLocked

  // Key sync states
  const baseCamelotA = deckA.track?.key?.camelot
  const baseCamelotB = deckB.track?.key?.camelot
  const effCamelotA = baseCamelotA ? shiftCamelot(baseCamelotA, deckA.keyShift) : null
  const effCamelotB = baseCamelotB ? shiftCamelot(baseCamelotB, deckB.keyShift) : null

  const optShiftA = baseCamelotA && effCamelotB ? findKeySyncShift(baseCamelotA, effCamelotB) : 0
  const optShiftB = baseCamelotB && effCamelotA ? findKeySyncShift(baseCamelotB, effCamelotA) : 0

  const isKeySyncedA = Boolean(
    baseCamelotA &&
      effCamelotB &&
      (effCamelotA === effCamelotB || deckA.keyShift === optShiftA) &&
      (deckA.keyShift !== 0 || baseCamelotA === effCamelotB)
  )
  const isKeySyncedB = Boolean(
    baseCamelotB &&
      effCamelotA &&
      (effCamelotB === effCamelotA || deckB.keyShift === optShiftB) &&
      (deckB.keyShift !== 0 || baseCamelotB === effCamelotA)
  )

  const handleKeySyncA = () => {
    if (!deckA.track || !deckB.track || !baseCamelotA || !effCamelotB) return
    if (isKeySyncedA && deckA.keyShift !== 0) deckA.resetKeyShift()
    else deckA.setKeyShift(optShiftA)
  }

  const handleKeySyncB = () => {
    if (!deckB.track || !deckA.track || !baseCamelotB || !effCamelotA) return
    if (isKeySyncedB && deckB.keyShift !== 0) deckB.resetKeyShift()
    else deckB.setKeyShift(optShiftB)
  }

  // FX assign state: Deck A, Deck B, or Master
  const [fxAssign, setFxAssign] = useState<'A' | 'B' | 'MST'>('MST')

  // FX helpers with channel assignment (Deck A, Deck B, or Master)
  const toggleEcho = () => {
    if (fxAssign === 'A') {
      if (deckA.fxType === 'echo' && deckA.fxWet > 0) {
        deckA.setFxWet(0)
      } else {
        deckA.setFx('echo')
        deckA.setFxWet(0.55)
      }
    } else if (fxAssign === 'B') {
      if (deckB.fxType === 'echo' && deckB.fxWet > 0) {
        deckB.setFxWet(0)
      } else {
        deckB.setFx('echo')
        deckB.setFxWet(0.55)
      }
    } else {
      const anyEcho = (deckA.fxType === 'echo' && deckA.fxWet > 0) || (deckB.fxType === 'echo' && deckB.fxWet > 0)
      if (anyEcho) {
        deckA.setFxWet(0)
        deckB.setFxWet(0)
      } else {
        deckA.setFx('echo')
        deckA.setFxWet(0.55)
        deckB.setFx('echo')
        deckB.setFxWet(0.55)
      }
    }
  }

  const toggleReverb = () => {
    if (fxAssign === 'A') {
      if (deckA.fxType === 'reverb' && deckA.fxWet > 0) {
        deckA.setFxWet(0)
      } else {
        deckA.setFx('reverb')
        deckA.setFxWet(0.5)
      }
    } else if (fxAssign === 'B') {
      if (deckB.fxType === 'reverb' && deckB.fxWet > 0) {
        deckB.setFxWet(0)
      } else {
        deckB.setFx('reverb')
        deckB.setFxWet(0.5)
      }
    } else {
      const anyReverb = (deckA.fxType === 'reverb' && deckA.fxWet > 0) || (deckB.fxType === 'reverb' && deckB.fxWet > 0)
      if (anyReverb) {
        deckA.setFxWet(0)
        deckB.setFxWet(0)
      } else {
        deckA.setFx('reverb')
        deckA.setFxWet(0.5)
        deckB.setFx('reverb')
        deckB.setFxWet(0.5)
      }
    }
  }

  /**
   * Which single deck a master-assigned FX should hit.
   *
   * MST means "the mix as it is being heard", so it resolves to one deck rather than
   * every playing deck. Firing on both at once was the old behaviour and it doubled the
   * hit — two SCR chops or two brakes starting a few milliseconds apart read as a flam
   * instead of one punch, which is why A and B sounded right and MST did not.
   *
   * The crossfader already says which side the audience is on, so that picks the deck;
   * a playing deck beats a stopped one, and a deck holding a track beats an empty one.
   */
  const pickMasterDeck = () => {
    const favourA = engine.crossfade <= 0
    const preferred = favourA ? deckA : deckB
    const other = favourA ? deckB : deckA
    if (preferred.track && preferred.playing) return preferred
    if (other.track && other.playing) return other
    return preferred.track ? preferred : other
  }

  /** The one deck an FX button acts on, for any of the three assignments. */
  const fxTargetDeck = () =>
    fxAssign === 'A' ? deckA : fxAssign === 'B' ? deckB : pickMasterDeck()

  const triggerBrake = async () => {
    const target = fxTargetDeck()
    if (!target.track) return
    void target.triggerBrake()
  }

  const triggerCutter = async () => {
    const target = fxTargetDeck()
    if (!target.track) return
    void target.triggerCutter()
  }

  const isEchoActive = fxAssign === 'A'
    ? deckA.fxType === 'echo' && deckA.fxWet > 0
    : fxAssign === 'B'
    ? deckB.fxType === 'echo' && deckB.fxWet > 0
    : (deckA.fxType === 'echo' && deckA.fxWet > 0) || (deckB.fxType === 'echo' && deckB.fxWet > 0)

  const isReverbActive = fxAssign === 'A'
    ? deckA.fxType === 'reverb' && deckA.fxWet > 0
    : fxAssign === 'B'
    ? deckB.fxType === 'reverb' && deckB.fxWet > 0
    : (deckA.fxType === 'reverb' && deckA.fxWet > 0) || (deckB.fxType === 'reverb' && deckB.fxWet > 0)

  return (
    <div
      className={`flex items-stretch justify-between gap-2 px-3 py-1.5 bg-[#1C1C1C] rounded-xl border border-[#282828] select-none h-full shadow-inner ${className}`}
    >
      {/* ================= 1. DECK A CHANNEL FADER ================= */}
      <div className="flex flex-col items-center justify-between py-1 w-12 shrink-0">
        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">
          A
        </span>
        <div className="h-[135px] flex items-center justify-center my-auto">
          <Fader
            orientation="vertical"
            min={0}
            max={1}
            step={0.01}
            value={volumeA}
            defaultValue={1}
            onDragChange={v => deckA.setVolume(v)}
            onValueChange={v => {
              setVolumeA(v)
              deckA.setVolume(v)
            }}
            accentColor="#34d399"
            analyser={deckA.analyser}
            className="w-7 h-[135px]"
          />
        </div>
      </div>

      {/* ================= 2. DECK A EQ COLUMN (GAIN, HI, MID, LOW) ================= */}
      <div className="flex flex-col justify-between items-center py-1 w-12 shrink-0">
        <EqKnobItem
          label="GAIN"
          knob={
            <Knob
              size={40}
              min={0}
              max={2}
              defaultValue={1}
              bipolar
              value={gainA}
              onValueChange={v => {
                setGainA(v)
                deckA.setGain(v)
              }}
              accentColor="#34d399"
            />
          }
        />
        <EqKnobItem
          label="HI"
          knob={
            <Knob
              size={40}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={eqHighA}
              onValueChange={v => {
                setEqHighA(v)
                deckA.setEqHigh(v)
              }}
              accentColor="#34d399"
            />
          }
        />
        <EqKnobItem
          label="MID"
          knob={
            <Knob
              size={40}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={eqMidA}
              onValueChange={v => {
                setEqMidA(v)
                deckA.setEqMid(v)
              }}
              accentColor="#34d399"
            />
          }
        />
        <EqKnobItem
          label="LOW"
          knob={
            <Knob
              size={40}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              // Read from the engine rather than local state: the AUTO autopilot drives the Low
              // of both decks during a fade, and a knob that mirrors only its own pointer would
              // show a still knob while the mix underneath it is moving.
              value={deckA.eqLowGain}
              onValueChange={v => deckA.setEqLow(v)}
              accentColor="#34d399"
            />
          }
        />
      </div>

      {/* ================= 3. CENTER PANEL (FILTERS + FX + SYNC/KEY) ================= */}
      <div className="flex flex-col justify-between items-center py-1 px-2 bg-[#161616] rounded-lg border border-[#282828] w-[132px] shrink-0">
        {/* Top: Filter Knobs A & B */}
        <div className="flex items-center justify-center gap-4 w-full pt-1">
          <div className="flex flex-col items-center">
            <FilterKnob
              size={40}
              value={filterA}
              onChange={v => {
                setFilterA(v)
                deckA.setFilter(v)
              }}
              accentColor="#34d399"
            />
          </div>

          <div className="flex flex-col items-center">
            <FilterKnob
              size={40}
              value={filterB}
              onChange={v => {
                setFilterB(v)
                deckB.setFilter(v)
              }}
              accentColor="#a855f7"
            />
          </div>
        </div>

        {/* FX Target Assignment Header & Buttons */}
        <div className="flex flex-col items-center w-full max-w-[104px] mt-0.5">
          <span className="text-[7px] font-semibold text-[#888888] uppercase tracking-widest mb-1.5">
            FX
          </span>
          <div className="grid grid-cols-3 gap-1.5 w-full">
            <button
              type="button"
              onClick={() => setFxAssign('A')}
              className={`h-[18px] rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
                fxAssign === 'A'
                  ? 'bg-[#161616] text-white border-white shadow-[0_0_6px_rgba(255,255,255,0.45)]'
                  : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
              title="Assign FX to Deck A"
            >
              A
            </button>
            <button
              type="button"
              onClick={() => setFxAssign('MST')}
              className={`h-[18px] rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
                fxAssign === 'MST'
                  ? 'bg-[#161616] text-white border-white shadow-[0_0_6px_rgba(255,255,255,0.45)]'
                  : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
              title="Assign FX to Master — echo/reverb apply to both decks; one-shot FX (SCR / BRK) fire on the deck the crossfader favours"
            >
              MST
            </button>
            <button
              type="button"
              onClick={() => setFxAssign('B')}
              className={`h-[18px] rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
                fxAssign === 'B'
                  ? 'bg-[#161616] text-white border-white shadow-[0_0_6px_rgba(255,255,255,0.45)]'
                  : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
              title="Assign FX to Deck B"
            >
              B
            </button>
          </div>

          {/* Circuit Routing Bracket connecting A/MST/B to FX block */}
          <svg
            className="w-full h-[12px] mt-2 mb-0.5 pointer-events-none"
            viewBox="0 0 104 12"
            fill="none"
          >
            {/* Left tick down from A */}
            <line x1="15.5" y1="0" x2="15.5" y2="6" stroke="#4a4a4a" strokeWidth="1" shapeRendering="crispEdges" />
            {/* Right tick down from B */}
            <line x1="88.5" y1="0" x2="88.5" y2="6" stroke="#4a4a4a" strokeWidth="1" shapeRendering="crispEdges" />
            {/* Horizontal connecting bar */}
            <line x1="15.5" y1="6" x2="88.5" y2="6" stroke="#4a4a4a" strokeWidth="1" shapeRendering="crispEdges" />
            {/* Center cross/stem under MST */}
            <line x1="52" y1="1" x2="52" y2="12" stroke="#4a4a4a" strokeWidth="1" shapeRendering="crispEdges" />
          </svg>
        </div>

        {/* Middle: 2x2 Performance FX Buttons [ECHO, RVRB, BRK, SPIN] */}
        <div className="grid grid-cols-2 gap-1.5 w-full max-w-[104px] -mt-2 mb-0.5">
          <button
            type="button"
            onClick={toggleEcho}
            className={`h-[18px] rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
              isEchoActive
                ? 'bg-[#141414] text-white border-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title="Toggle Echo effect"
          >
            ECHO
          </button>
          <button
            type="button"
            onClick={toggleReverb}
            className={`h-[18px] rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
              isReverbActive
                ? 'bg-[#141414] text-white border-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title="Toggle Reverb effect"
          >
            RVRB
          </button>
          <button
            type="button"
            onClick={triggerBrake}
            className="h-[18px] rounded-[3px] border bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444] active:border-white active:text-white text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center"
            title="Vinyl Brake stop effect"
          >
            BRK
          </button>
          <button
            type="button"
            onClick={triggerCutter}
            className="h-[18px] rounded-[3px] border bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444] active:border-white active:text-white text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center"
            title="SCR — forward cutter: plays the chop sample at this deck's tempo"
          >
            SCR
          </button>
        </div>

        {/* Bottom: 2x2 SYNC & KEY Buttons */}
        <div className="grid grid-cols-2 gap-1.5 w-full max-w-[104px] mb-0.5">
          <button
            type="button"
            onClick={() => deckA.syncTo(deckB)}
            disabled={!deckA.track || !deckB.track}
            className={`h-[18px] rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
              isSyncedA
                ? 'bg-[#141414] text-white border-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-30'
            }`}
            title="Deck A Tempo Sync"
          >
            SYNC
          </button>
          <button
            type="button"
            onClick={() => deckB.syncTo(deckA)}
            disabled={!deckB.track || !deckA.track}
            className={`h-[18px] rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
              isSyncedB
                ? 'bg-[#141414] text-white border-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-30'
            }`}
            title="Deck B Tempo Sync"
          >
            SYNC
          </button>
          <button
            type="button"
            onClick={handleKeySyncA}
            disabled={!deckA.track || !deckB.track}
            className={`h-[18px] rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
              isKeySyncedA
                ? 'bg-[#221808] text-amber-400 border-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.35)]'
                : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-30'
            }`}
            title="Deck A Harmonic Key Sync"
          >
            KEY
          </button>
          <button
            type="button"
            onClick={handleKeySyncB}
            disabled={!deckB.track || !deckA.track}
            className={`h-[18px] rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
              isKeySyncedB
                ? 'bg-[#221808] text-amber-400 border-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.35)]'
                : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-30'
            }`}
            title="Deck B Harmonic Key Sync"
          >
            KEY
          </button>
        </div>
      </div>

      {/* ================= 4. DECK B EQ COLUMN (GAIN, HI, MID, LOW) ================= */}
      <div className="flex flex-col justify-between items-center py-1 w-12 shrink-0">
        <EqKnobItem
          label="GAIN"
          knob={
            <Knob
              size={40}
              min={0}
              max={2}
              defaultValue={1}
              bipolar
              value={gainB}
              onValueChange={v => {
                setGainB(v)
                deckB.setGain(v)
              }}
              accentColor="#a855f7"
            />
          }
        />
        <EqKnobItem
          label="HI"
          knob={
            <Knob
              size={40}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={eqHighB}
              onValueChange={v => {
                setEqHighB(v)
                deckB.setEqHigh(v)
              }}
              accentColor="#a855f7"
            />
          }
        />
        <EqKnobItem
          label="MID"
          knob={
            <Knob
              size={40}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={eqMidB}
              onValueChange={v => {
                setEqMidB(v)
                deckB.setEqMid(v)
              }}
              accentColor="#a855f7"
            />
          }
        />
        <EqKnobItem
          label="LOW"
          knob={
            <Knob
              size={40}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              // Mirrors the engine — see the Deck A LOW knob above.
              value={deckB.eqLowGain}
              onValueChange={v => deckB.setEqLow(v)}
              accentColor="#a855f7"
            />
          }
        />
      </div>

      {/* ================= 5. DECK B CHANNEL FADER ================= */}
      <div className="flex flex-col items-center justify-between py-1 w-12 shrink-0">
        <span className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">
          B
        </span>
        <div className="h-[135px] flex items-center justify-center my-auto">
          <Fader
            orientation="vertical"
            min={0}
            max={1}
            step={0.01}
            value={volumeB}
            defaultValue={1}
            onDragChange={v => deckB.setVolume(v)}
            onValueChange={v => {
              setVolumeB(v)
              deckB.setVolume(v)
            }}
            accentColor="#a855f7"
            analyser={deckB.analyser}
            className="w-7 h-[135px]"
          />
        </div>
      </div>
    </div>
  )
}

function EqKnobItem({ label, knob }: { label: string; knob: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[7.5px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5">
        {label}
      </span>
      {knob}
    </div>
  )
}
