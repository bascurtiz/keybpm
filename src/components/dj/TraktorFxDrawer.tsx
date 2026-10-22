import { useEffect, useState } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import type { FxType } from '@/lib/dj/types'
import { Knob } from './Knob'
import { ACTIVE_KEY } from '@/lib/dj/control-state'

interface TraktorFxDrawerProps {
  deck: DeckEngine
  deckId: 'A' | 'B'
  accentColor: string
  onClose: () => void
}

const FX_TYPES: { type: FxType; label: string }[] = [
  { type: 'echo', label: 'ECHO' },
  { type: 'reverb', label: 'REVERB' },
  { type: 'flanger', label: 'FLANGER' },
]

const FX_BEAT_PRESETS = [0.5, 1, 2, 4]

export function TraktorFxDrawer({
  deck,
  deckId,
  accentColor,
  onClose,
}: TraktorFxDrawerProps) {
  const [, setVer] = useState(0)
  useEffect(() => {
    const unsub = deck.subscribe(() => setVer(v => v + 1))
    return () => {
      unsub()
    }
  }, [deck])

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2 bg-[#161616] border-b border-[#282828] animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accentColor }}>
          DECK {deckId} FX UNIT
        </span>

        {/* FX Type pills */}
        <div className="flex items-center gap-1 bg-[#161616] p-0.5 rounded border border-[#282828]">
          {FX_TYPES.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              onClick={() => deck.setFx(type)}
              className={`px-2 py-0.5 text-[9px] font-bold rounded border transition-colors ${
                deck.fxType === type
                  ? ACTIVE_KEY
                  : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* FX Beats */}
        <div className="flex items-center gap-1 text-[9px]">
          <span className="text-[#666666] font-bold">BEATS:</span>
          {FX_BEAT_PRESETS.map(b => (
            <button
              key={b}
              type="button"
              onClick={() => deck.setFxBeats(b)}
              className={`px-1.5 py-0.5 rounded font-mono font-bold border transition-colors ${
                deck.fxBeats === b
                  ? ACTIVE_KEY
                  : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
            >
              {b === 0.5 ? '½' : b}
            </button>
          ))}
        </div>
      </div>

      {/* FX Wet / Dry Knob */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
            DRY/WET
          </span>
          <Knob
            size={34}
            min={0}
            max={1}
            value={deck.fxWet}
            defaultValue={0}
            onValueChange={v => deck.setFxWet(v)}
            accentColor={accentColor}
          />
          <span className="text-[9px] font-mono text-zinc-400 w-7 tabular-nums">
            {Math.round(deck.fxWet * 100)}%
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-white px-1.5 py-0.5 rounded"
          title="Close FX drawer"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
