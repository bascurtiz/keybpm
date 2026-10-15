import { useEffect, useRef } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { beatInBarAt } from '@/lib/dj/grid'

interface BeatCounterProps {
  deckA: DeckEngine
  deckB: DeckEngine
  className?: string
}

export function BeatCounter({ deckA, deckB, className = '' }: BeatCounterProps) {
  const beatAEls = useRef<(HTMLDivElement | null)[]>([])
  const beatBEls = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      // Deck A 4-beat bar indicator. The grid module resolves the phase, so this
      // stays correct on both constant and variable-tempo grids.
      const gridA = deckA.track?.grid
      const beatsPerBarA = gridA?.beatsPerBar || 4
      const activeIdxA = beatInBarAt(gridA, deckA.position, 0.04) % beatsPerBarA

      for (let i = 0; i < 4; i++) {
        const el = beatAEls.current[i]
        if (el) {
          const isCurrent = (deckA.playing || deckA.position > 0) && activeIdxA === i && !!deckA.track
          el.style.backgroundColor = isCurrent ? '#34d399' : '#141414'
          el.style.borderColor = isCurrent ? '#6ee7b7' : '#282828'
          el.style.opacity = isCurrent ? '1' : '0.3'
          el.style.boxShadow = isCurrent ? '0 0 6px rgba(52, 211, 153, 0.6)' : 'none'
        }
      }

      // Deck B 4-beat bar indicator
      const gridB = deckB.track?.grid
      const beatsPerBarB = gridB?.beatsPerBar || 4
      const activeIdxB = beatInBarAt(gridB, deckB.position, 0.04) % beatsPerBarB

      for (let i = 0; i < 4; i++) {
        const el = beatBEls.current[i]
        if (el) {
          const isCurrent = (deckB.playing || deckB.position > 0) && activeIdxB === i && !!deckB.track
          el.style.backgroundColor = isCurrent ? '#a855f7' : '#141414'
          el.style.borderColor = isCurrent ? '#c084fc' : '#282828'
          el.style.opacity = isCurrent ? '1' : '0.3'
          el.style.boxShadow = isCurrent ? '0 0 6px rgba(168, 85, 247, 0.6)' : 'none'
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deckA, deckB])

  return (
    <div
      className={`w-full flex flex-col justify-center px-1.5 py-1 rounded bg-[#101010] border border-[#282828] shadow-inner select-none ${className}`}
      title="4-Beat Metronome Bar Counter (Deck A: Green, Deck B: Purple)"
    >
      {/* Deck A 4-beat metronome row */}
      <div className="grid grid-cols-4 gap-1.5 h-[8px] w-full">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            ref={el => {
              beatAEls.current[i] = el
            }}
            className="h-full rounded-[2px] border border-[#282828] bg-[#141414] transition-all duration-75"
          />
        ))}
      </div>

      {/* Deck B 4-beat metronome row */}
      <div className="grid grid-cols-4 gap-1.5 h-[8px] w-full mt-1">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            ref={el => {
              beatBEls.current[i] = el
            }}
            className="h-full rounded-[2px] border border-[#282828] bg-[#141414] transition-all duration-75"
          />
        ))}
      </div>
    </div>
  )
}
