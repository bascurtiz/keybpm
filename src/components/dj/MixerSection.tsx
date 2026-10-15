import { useEffect, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { Knob } from './Knob'
import { FilterKnob } from './FilterKnob'
import { Fader } from './Fader'
import { StackedWaveforms } from './StackedWaveforms'

interface MixerSectionProps {
  engine: AudioEngine
  className?: string
}

export function MixerSection({ engine, className = '' }: MixerSectionProps) {
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

  const nudgeCrossfade = (delta: number) => {
    engine.setCrossfade(engine.crossfade + delta)
  }

  return (
    <div className={`grid grid-cols-[auto_1fr_auto] gap-2 items-stretch h-full w-full select-none ${className}`}>
      {/* ================= DECK A CHANNEL MIXER STRIP ================= */}
      <ChannelStrip deck={deckA} deckId="A" accentColor="#10b981" />

      {/* ================= CENTER: STACKED WAVEFORMS & CROSSFADER ================= */}
      <div className="flex flex-col justify-between gap-1 h-full min-w-0 flex-1 overflow-hidden">
        {/* Stacked Scrolling Parallel Waveforms */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <StackedWaveforms deckA={deckA} deckB={deckB} className="h-full w-full" />
        </div>

        {/* Crossfader Section with < [ ■ ] > */}
        <div className="flex items-center justify-center gap-3 px-4 h-8 shrink-0">
          <button
            type="button"
            onClick={() => nudgeCrossfade(-0.05)}
            className="text-xs font-bold text-[#8c919c] hover:text-white transition-colors shrink-0 px-1"
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
            onDragChange={v => engine.setCrossfade(v)}
            onValueChange={v => engine.setCrossfade(v)}
            label="Crossfader"
            className="h-6 w-[130px] max-w-[130px]"
          />

          <button
            type="button"
            onClick={() => nudgeCrossfade(0.05)}
            className="text-xs font-bold text-[#8c919c] hover:text-white transition-colors shrink-0 px-1"
            title="Nudge Crossfader toward Deck B"
          >
            &gt;
          </button>
        </div>
      </div>

      {/* ================= DECK B CHANNEL MIXER STRIP ================= */}
      <ChannelStrip deck={deckB} deckId="B" accentColor="#a855f7" />
    </div>
  )
}

function ChannelStrip({
  deck,
  deckId,
  accentColor,
}: {
  deck: DeckEngine
  deckId: 'A' | 'B'
  accentColor: string
}) {
  const [gain, setGain] = useState(1)
  const [filter, setFilter] = useState(0)
  const [volume, setVolume] = useState(1)

  return (
    <div className="flex flex-col items-center justify-between h-full py-0.5 shrink-0 w-[46px]">
      {/* Upper Knobs Section: Gain on top (aligned with High), Filter below (aligned with Mid) */}
      <div className="shrink-0 flex flex-col items-center w-full pt-2.5">
        {/* Gain knob (size 24) aligned with High knob center */}
        <Knob
          size={24}
          min={0}
          max={2}
          value={gain}
          defaultValue={1}
          bipolar
          onValueChange={v => {
            setGain(v)
            deck.setGain(v)
          }}
          label="Gain"
          labelPlacement="bottom"
          accentColor={accentColor}
          format={v => `${(v * 100).toFixed(0)}%`}
          onDotClick={() => {
            setGain(1)
            deck.setGain(1)
          }}
          dotTitle="Gain Reset — Click dot to jump back to 100% (0dB)"
        />

        {/* Filter knob (size 40) aligned with Mid knob center */}
        <div className="shrink-0 flex items-center justify-center pt-4">
          <FilterKnob
            size={40}
            value={filter}
            onChange={v => {
              setFilter(v)
              deck.setFilter(v)
            }}
            accentColor={accentColor}
          />
        </div>
      </div>

      {/* Volume Slider with integrated VU-meter inside its track slot, extending down to align with Play button */}
      <div className="flex-1 w-full flex items-center justify-center pt-6 pb-0.5">
        <Fader
          orientation="vertical"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          defaultValue={1}
          ticks={0}
          onValueChange={v => {
            setVolume(v)
            deck.setVolume(v)
          }}
          label={`Deck ${deckId} Volume`}
          format={v => `${Math.round(v * 100)}%`}
          analyser={deck.analyser}
          className="h-full"
        />
      </div>
    </div>
  )
}
