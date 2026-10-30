import { useEffect, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import { Knob } from './Knob'
import { FilterKnob } from './FilterKnob'
import { Fader } from './Fader'
import { useViewportMode } from '@/lib/use-viewport'
import { FADER_CAP_W, KIOSK_FADER_CAP_W } from '@/lib/dj/control-size'

interface TraktorMixerProps {
  engine: AudioEngine
  className?: string
}

export function TraktorMixer({ engine, className = '' }: TraktorMixerProps) {
  const { kiosk } = useViewportMode()
  const deckA = engine.decks.A
  const deckB = engine.decks.B
  const [, setVer] = useState(0)

  const knobSize = kiosk ? 56 : 60
  const filterSize = kiosk ? 56 : 60
  const faderClass = kiosk ? 'w-6 h-[148px]' : 'w-6 h-[155px]'
  const colClass = `flex flex-col justify-between items-center ${kiosk ? 'py-1 w-[56px]' : 'py-1 w-[60px]'} shrink-0`

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

  return (
    <div
      className={`flex items-stretch gap-2.5 px-3 py-1.5 bg-[#1C1C1C] rounded-lg border border-[#282828] select-none h-full shadow-inner shrink-0 ${className}`}
    >
      {/* ================= 1. DECK A: FLTR & KEY KNOBS ================= */}
      <div className={colClass}>
        {/* Top: FLTR Knob with Teal pointer */}
        <FilterKnob
          size={filterSize}
          value={deckA.filterValue}
          onChange={v => deckA.setFilter(v)}
          accentColor="#34d399"
          pointerColor="#34d399"
          label="FLTR"
        />

        {/* Middle spacer matching MID knob height for 100% pixel-perfect horizontal row alignment */}
        <div className="invisible pointer-events-none select-none flex flex-col items-center justify-center" aria-hidden>
          <Knob size={knobSize} value={0} onValueChange={() => {}} label="MID" disabled />
        </div>

        {/* Bottom: KEY Transpose Knob with Dot indicator */}
        <Knob
          size={knobSize}
          min={-6}
          max={6}
          step={1}
          defaultValue={0}
          bipolar
          value={deckA.keyShift}
          onValueChange={v => deckA.setKeyShift(Math.round(v))}
          onDotClick={() => deckA.resetKeyShift()}
          dotTitle="Reset key shift to 0"
          isDotActive={deckA.keyShift !== 0}
          accentColor="#34d399"
          pointerColor="#ffffff"
          label="KEY"
          valueDisplay={deckA.keyShift !== 0 ? (deckA.keyShift > 0 ? `+${deckA.keyShift}` : `${deckA.keyShift}`) : undefined}
        />
      </div>

      {/* ================= 2. DECK A: EQ COLUMN (HI, MID, LO) ================= */}
      <div className={colClass}>
        <Knob
          label="HI"
          size={knobSize}
          min={-12}
          max={12}
          defaultValue={0}
          bipolar
          value={deckA.eqHighGain}
          onValueChange={v => deckA.setEqHigh(v)}
          accentColor="#34d399"
          pointerColor="#ffffff"
        />
        <Knob
          label="MID"
          size={knobSize}
          min={-12}
          max={12}
          defaultValue={0}
          bipolar
          value={deckA.eqMidGain}
          onValueChange={v => deckA.setEqMid(v)}
          accentColor="#34d399"
          pointerColor="#ffffff"
        />
        <Knob
          label="LO"
          size={knobSize}
          min={-12}
          max={12}
          defaultValue={0}
          bipolar
          value={deckA.eqLowGain}
          onValueChange={v => deckA.setEqLow(v)}
          accentColor="#34d399"
          pointerColor="#ffffff"
        />
      </div>

      {/* ================= 3. CENTER: CHANNEL FADERS & VU METERS ================= */}
      <div className="flex items-stretch gap-2.5 px-2.5 py-1 bg-[#161616] rounded-md border border-[#282828] shrink-0 h-full">
        {/* Channel A Fader */}
        <div className="flex flex-col items-center justify-between py-1 shrink-0 w-[48px]">
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
              capWidth={kiosk ? KIOSK_FADER_CAP_W : FADER_CAP_W}
              className={faderClass}
            />
          </div>
        </div>

        {/* Channel B Fader */}
        <div className="flex flex-col items-center justify-between py-1 shrink-0 w-[48px]">
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
              capWidth={kiosk ? KIOSK_FADER_CAP_W : FADER_CAP_W}
              className={faderClass}
            />
          </div>
        </div>
      </div>

      {/* ================= 4. DECK B: EQ COLUMN (HI, MID, LO) ================= */}
      <div className={colClass}>
        <Knob
          label="HI"
          size={knobSize}
          min={-12}
          max={12}
          defaultValue={0}
          bipolar
          value={deckB.eqHighGain}
          onValueChange={v => deckB.setEqHigh(v)}
          accentColor="#a855f7"
          pointerColor="#ffffff"
        />
        <Knob
          label="MID"
          size={knobSize}
          min={-12}
          max={12}
          defaultValue={0}
          bipolar
          value={deckB.eqMidGain}
          onValueChange={v => deckB.setEqMid(v)}
          accentColor="#a855f7"
          pointerColor="#ffffff"
        />
        <Knob
          label="LO"
          size={knobSize}
          min={-12}
          max={12}
          defaultValue={0}
          bipolar
          value={deckB.eqLowGain}
          onValueChange={v => deckB.setEqLow(v)}
          accentColor="#a855f7"
          pointerColor="#ffffff"
        />
      </div>

      {/* ================= 5. DECK B: FLTR & KEY KNOBS ================= */}
      <div className={colClass}>
        {/* Top: FLTR Knob with Purple pointer */}
        <FilterKnob
          size={filterSize}
          value={deckB.filterValue}
          onChange={v => deckB.setFilter(v)}
          accentColor="#a855f7"
          pointerColor="#a855f7"
          label="FLTR"
        />

        {/* Middle spacer matching MID knob height for 100% pixel-perfect horizontal row alignment */}
        <div className="invisible pointer-events-none select-none flex flex-col items-center justify-center" aria-hidden>
          <Knob size={knobSize} value={0} onValueChange={() => {}} label="MID" disabled />
        </div>

        {/* Bottom: KEY Transpose Knob with Dot indicator */}
        <Knob
          size={knobSize}
          min={-6}
          max={6}
          step={1}
          defaultValue={0}
          bipolar
          value={deckB.keyShift}
          onValueChange={v => deckB.setKeyShift(Math.round(v))}
          onDotClick={() => deckB.resetKeyShift()}
          dotTitle="Reset key shift to 0"
          isDotActive={deckB.keyShift !== 0}
          accentColor="#a855f7"
          pointerColor="#ffffff"
          label="KEY"
          valueDisplay={deckB.keyShift !== 0 ? (deckB.keyShift > 0 ? `+${deckB.keyShift}` : `${deckB.keyShift}`) : undefined}
        />
      </div>
    </div>
  )
}
