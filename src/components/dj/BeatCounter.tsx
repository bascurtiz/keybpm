import { useEffect, useRef } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { positiveMod } from '@/lib/dj/dsp'

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
      // Deck A 4-beat bar indicator
      const bpmA = deckA.effectiveBpm || deckA.track?.grid?.bpm || deckA.track?.bpm || 120
      const beatLenA = 60 / bpmA
      const firstBarA = deckA.track?.grid?.firstBar ?? deckA.track?.grid?.firstBeat ?? 0
      const beatNumA = Math.floor((deckA.position - firstBarA) / beatLenA)
      const beatsPerBarA = deckA.track?.grid?.beatsPerBar || 4
      const activeIdxA = positiveMod(beatNumA, beatsPerBarA)

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
      const bpmB = deckB.effectiveBpm || deckB.track?.grid?.bpm || deckB.track?.bpm || 120
      const beatLenB = 60 / bpmB
      const firstBarB = deckB.track?.grid?.firstBar ?? deckB.track?.grid?.firstBeat ?? 0
      const beatNumB = Math.floor((deckB.position - firstBarB) / beatLenB)
      const beatsPerBarB = deckB.track?.grid?.beatsPerBar || 4
      const activeIdxB = positiveMod(beatNumB, beatsPerBarB)

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
      className={`flex flex-col justify-between p-1 rounded bg-[#161616] border border-[#282828] shadow-inner select-none ${className}`}
      title="4-Beat Metronome Bar Counter (Deck A: Green, Deck B: Purple)"
    >
      {/* Deck A 4-beat metronome row */}
      <div className="grid grid-cols-4 gap-1 h-[7px] w-full">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            ref={el => {
              beatAEls.current[i] = el
            }}
            className="h-full rounded-[1.5px] border border-[#282828] bg-[#141414] transition-all duration-75"
          />
        ))}
      </div>

      {/* Deck B 4-beat metronome row */}
      <div className="grid grid-cols-4 gap-1 h-[7px] w-full mt-1">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            ref={el => {
              beatBEls.current[i] = el
            }}
            className="h-full rounded-[1.5px] border border-[#282828] bg-[#141414] transition-all duration-75"
          />
        ))}
      </div>
    </div>
  )
}
