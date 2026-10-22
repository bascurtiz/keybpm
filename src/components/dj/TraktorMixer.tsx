import { useEffect, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import { Knob } from './Knob'
import { FilterKnob } from './FilterKnob'
import { Fader } from './Fader'
import { useViewportMode } from '@/lib/use-viewport'
import { CONTROL_FRAME_W, CONTROL_H } from '@/lib/dj/control-size'
import { ACTIVE_KEY, CELL } from '@/lib/dj/control-state'

interface TraktorMixerProps {
  engine: AudioEngine
  className?: string
}

export function TraktorMixer({ engine, className = '' }: TraktorMixerProps) {
  const { kiosk } = useViewportMode()
  const deckA = engine.decks.A
  const deckB = engine.decks.B
  const [, setVer] = useState(0)

  const knobSize = kiosk ? 38 : 42
  const filterSize = kiosk ? 38 : 42
  const faderClass = kiosk ? 'w-6 h-[140px]' : 'w-6 h-[155px]'

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

  // FX assign state: Deck A, Deck B, or Master
  const [fxAssign, setFxAssign] = useState<'A' | 'B' | 'MST'>('MST')

  const toggleEcho = () => {
    if (fxAssign === 'A') {
      if (deckA.fxType === 'echo' && deckA.fxWet > 0) {
        deckA.setFxWet(0)
      } else {
        deckA.setFx('echo')
        deckA.setFxWet(0.5)
      }
    } else if (fxAssign === 'B') {
      if (deckB.fxType === 'echo' && deckB.fxWet > 0) {
        deckB.setFxWet(0)
      } else {
        deckB.setFx('echo')
        deckB.setFxWet(0.5)
      }
    } else {
      const anyEcho = (deckA.fxType === 'echo' && deckA.fxWet > 0) || (deckB.fxType === 'echo' && deckB.fxWet > 0)
      if (anyEcho) {
        deckA.setFxWet(0)
        deckB.setFxWet(0)
      } else {
        deckA.setFx('echo')
        deckA.setFxWet(0.5)
        deckB.setFx('echo')
        deckB.setFxWet(0.5)
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

  const pickMasterDeck = () => {
    const favourA = engine.crossfade <= 0
    const preferred = favourA ? deckA : deckB
    const other = favourA ? deckB : deckA
    if (preferred.track && preferred.playing) return preferred
    if (other.track && other.playing) return other
    return preferred.track ? preferred : other
  }

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
      className={`flex items-stretch gap-2 px-2 py-1.5 bg-[#1C1C1C] rounded-lg border border-[#282828] select-none h-full shadow-inner shrink-0 ${className}`}
    >
      {/* ================= 1. DECK A CHANNEL FADER ================= */}
      {/* Column widths are the console's width budget: on a desktop the outer fader columns
          are 44 (was 36), the EQ columns 52 (was 40) and the filter/FX panel 186 (was 136),
          which is the mixer's share of the deck row's 150 px widening — 428 in total. Kiosk
          has its own, smaller set (40 / 44 / 142, 360 in total): the phone's console is too
          short to bind on width, so its columns can grow with the design without costing
          anything, and a phone's knobs are reached by a thumb that benefits from the room. */}
      <div className={`flex flex-col items-center justify-between py-1 shrink-0 ${kiosk ? 'w-10' : 'w-11'}`}>
        <span className="text-[12px] font-bold text-emerald-400 uppercase tracking-wider mb-1 leading-none">
          A
        </span>
        <div className="flex items-center justify-center my-auto">
          <Fader
            orientation="vertical"
            min={0}
            max={1}
            step={0.01}
            value={deckA.volume}
            defaultValue={1}
            onDragChange={v => deckA.setVolume(v)}
            onValueChange={v => deckA.setVolume(v)}
            accentColor="#34d399"
            analyser={deckA.analyser}
            className={faderClass}
          />
        </div>
      </div>

      {/* ================= 2. DECK A EQ COLUMN (GAIN, HI, MID, LOW) ================= */}
      <div
        className={`flex flex-col justify-between items-center py-0.5 shrink-0 ${
          kiosk ? 'w-11' : 'w-[52px]'
        }`}
      >
        <EqKnobItem
          label="GAIN"
          knob={
            <Knob
              size={knobSize}
              min={0}
              max={2}
              defaultValue={1}
              bipolar
              value={deckA.gain}
              onValueChange={v => deckA.setGain(v)}
              accentColor="#34d399"
            />
          }
        />
        <EqKnobItem
          label="HI"
          knob={
            <Knob
              size={knobSize}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={deckA.eqHighGain}
              onValueChange={v => deckA.setEqHigh(v)}
              accentColor="#34d399"
            />
          }
        />
        <EqKnobItem
          label="MID"
          knob={
            <Knob
              size={knobSize}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={deckA.eqMidGain}
              onValueChange={v => deckA.setEqMid(v)}
              accentColor="#34d399"
            />
          }
        />
        <EqKnobItem
          label="LOW"
          knob={
            <Knob
              size={knobSize}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={deckA.eqLowGain}
              onValueChange={v => deckA.setEqLow(v)}
              accentColor="#34d399"
            />
          }
        />
      </div>

      {/* ================= 3. CENTER PANEL (FILTERS + FX) ================= */}
      <div
        className="relative flex flex-col items-center py-2 bg-[#161616] rounded-md border border-[#282828] w-[142px] shrink-0 h-full"
      >
        {/* Top: Filter Knobs A & B */}
        <div className="flex items-center justify-center gap-3.5 w-full px-2">
          <div className="flex flex-col items-center">
            <FilterKnob
              size={filterSize}
              value={deckA.filterValue}
              onChange={v => deckA.setFilter(v)}
              accentColor="#34d399"
            />
          </div>

          <div className="flex flex-col items-center">
            <FilterKnob
              size={filterSize}
              value={deckB.filterValue}
              onChange={v => deckB.setFilter(v)}
              accentColor="#a855f7"
            />
          </div>
        </div>

        {/* FX module: target assignment, routing bracket and the four performance buttons. */}
        <div className="flex flex-1 min-h-0 w-full items-center justify-center">
        <div className="flex flex-col items-center w-full max-w-[109px] mt-2">
          {/* Same caption as the deck's CUES label: 8.5 px, #888888, tracking-wider. The
              FX group is the second labelled cluster on the console, and at 7 px with
              wider tracking it read as a smaller, different class of heading. */}
          {/* Same 8 px caption gap as the deck's CUES label, for the same reason: at 4 px the
              word was nearer the A / MST / B row than the row is to the panel's border. The
              module is centred in the space under the filters, so the extra 4 px comes out
              of that centring, not out of the FX buttons. */}
          <span className="text-[8.5px] font-semibold text-[#777777] uppercase tracking-wider mb-2 leading-none select-none">
            FX
          </span>
          <div className="grid grid-cols-3 gap-1 w-full">
            <button
              type="button"
              onClick={() => setFxAssign('A')}
              style={{ height: CONTROL_H }}
              className={`rounded-[3px] border text-[8px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
                fxAssign === 'A'
                  ? ACTIVE_KEY
                  : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
              title="Assign FX to Deck A"
            >
              A
            </button>
            <button
              type="button"
              onClick={() => setFxAssign('MST')}
              style={{ height: CONTROL_H }}
              className={`rounded-[3px] border text-[8px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
                fxAssign === 'MST'
                  ? ACTIVE_KEY
                  : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
              title="Assign FX to Master"
            >
              MST
            </button>
            <button
              type="button"
              onClick={() => setFxAssign('B')}
              style={{ height: CONTROL_H }}
              className={`rounded-[3px] border text-[8px] font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
                fxAssign === 'B'
                  ? ACTIVE_KEY
                  : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
              title="Assign FX to Deck B"
            >
              B
            </button>
          </div>

          {/* Circuit Routing Bracket */}
          <svg
            className="w-full h-[10px] my-1 pointer-events-none"
            viewBox="0 0 104 10"
            fill="none"
          >
            <line x1="15.5" y1="0" x2="15.5" y2="5" stroke="#4a4a4a" strokeWidth="1" shapeRendering="crispEdges" />
            <line x1="88.5" y1="0" x2="88.5" y2="5" stroke="#4a4a4a" strokeWidth="1" shapeRendering="crispEdges" />
            <line x1="15.5" y1="5" x2="88.5" y2="5" stroke="#4a4a4a" strokeWidth="1" shapeRendering="crispEdges" />
            <line x1="52" y1="1" x2="52" y2="10" stroke="#4a4a4a" strokeWidth="1" shapeRendering="crispEdges" />
          </svg>

          {/* Performance FX Columns: [ECHO+BRK] and [RVRB+SCR] tight pairs */}
          <div className="flex items-stretch gap-px w-full" style={{ maxWidth: CONTROL_FRAME_W * 2 + 1 }}>
            {/* Left: ECHO & BRK unified container */}
            <div
              style={{ width: CONTROL_FRAME_W }}
              className="flex flex-col shrink-0 rounded-[3px] border border-[#282828] bg-[#141414] overflow-hidden"
            >
              <button
                type="button"
                onClick={toggleEcho}
                style={{ height: CONTROL_H }}
                className={`w-full ${CELL} text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center select-none ${
                  isEchoActive
                    ? ACTIVE_KEY
                    : 'bg-[#141414] text-[#777777] border-b-[#282828] hover:text-[#d4d4d4] hover:border-b-[#444444]'
                }`}
                title="Toggle Echo effect"
              >
                ECHO
              </button>
              <button
                type="button"
                onClick={triggerBrake}
                style={{ height: CONTROL_H }}
                className="w-full bg-[#141414] text-[#777777] hover:text-[#d4d4d4] active:text-[#d9a06a] text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center select-none"
                title="Vinyl Brake stop effect"
              >
                BRK
              </button>
            </div>

            {/* Right: RVRB & SCR unified container */}
            <div
              style={{ width: CONTROL_FRAME_W }}
              className="flex flex-col shrink-0 rounded-[3px] border border-[#282828] bg-[#141414] overflow-hidden"
            >
              <button
                type="button"
                onClick={toggleReverb}
                style={{ height: CONTROL_H }}
                className={`w-full ${CELL} text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center select-none ${
                  isReverbActive
                    ? ACTIVE_KEY
                    : 'bg-[#141414] text-[#777777] border-b-[#282828] hover:text-[#d4d4d4] hover:border-b-[#444444]'
                }`}
                title="Toggle Reverb effect"
              >
                RVRB
              </button>
              <button
                type="button"
                onClick={triggerCutter}
                style={{ height: CONTROL_H }}
                className="w-full bg-[#141414] text-[#777777] hover:text-[#d4d4d4] active:text-[#d9a06a] text-[7.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center select-none"
                title="SCR — forward cutter: plays the chop sample at this deck's tempo"
              >
                SCR
              </button>
            </div>
          </div>
        </div>
        </div>

      </div>

      {/* ================= 4. DECK B EQ COLUMN (GAIN, HI, MID, LOW) ================= */}
      <div
        className={`flex flex-col justify-between items-center py-0.5 shrink-0 ${
          kiosk ? 'w-11' : 'w-[52px]'
        }`}
      >
        <EqKnobItem
          label="GAIN"
          knob={
            <Knob
              size={knobSize}
              min={0}
              max={2}
              defaultValue={1}
              bipolar
              value={deckB.gain}
              onValueChange={v => deckB.setGain(v)}
              accentColor="#a855f7"
            />
          }
        />
        <EqKnobItem
          label="HI"
          knob={
            <Knob
              size={knobSize}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={deckB.eqHighGain}
              onValueChange={v => deckB.setEqHigh(v)}
              accentColor="#a855f7"
            />
          }
        />
        <EqKnobItem
          label="MID"
          knob={
            <Knob
              size={knobSize}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={deckB.eqMidGain}
              onValueChange={v => deckB.setEqMid(v)}
              accentColor="#a855f7"
            />
          }
        />
        <EqKnobItem
          label="LOW"
          knob={
            <Knob
              size={knobSize}
              min={-12}
              max={12}
              defaultValue={0}
              bipolar
              value={deckB.eqLowGain}
              onValueChange={v => deckB.setEqLow(v)}
              accentColor="#a855f7"
            />
          }
        />
      </div>

      {/* ================= 5. DECK B CHANNEL FADER ================= */}
      <div className={`flex flex-col items-center justify-between py-1 shrink-0 ${kiosk ? 'w-10' : 'w-11'}`}>
        <span className="text-[12px] font-bold text-purple-400 uppercase tracking-wider mb-1 leading-none">
          B
        </span>
        <div className="flex items-center justify-center my-auto">
          <Fader
            orientation="vertical"
            min={0}
            max={1}
            step={0.01}
            value={deckB.volume}
            defaultValue={1}
            onDragChange={v => deckB.setVolume(v)}
            onValueChange={v => deckB.setVolume(v)}
            accentColor="#a855f7"
            analyser={deckB.analyser}
            className={faderClass}
          />
        </div>
      </div>
    </div>
  )
}

function EqKnobItem({ label, knob }: { label: string; knob: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[7.5px] font-sans font-bold text-[#777777] uppercase tracking-widest mb-0.5">
        {label}
      </span>
      {knob}
    </div>
  )
}
