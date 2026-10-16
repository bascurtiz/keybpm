import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import { MiniWaveform } from './MiniWaveform'
import { Knob } from './Knob'
import { beatInBarAt } from '@/lib/dj/grid'
import { camelotColor, shiftCamelot } from '@/lib/camelot'

interface TopBarProps {
  engine: AudioEngine
  onLoadTrackClick?: (deckId: 'A' | 'B') => void
}

function formatMinutesSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function TopBar({ engine, onLoadTrackClick }: TopBarProps) {
  const deckA = engine.decks.A
  const deckB = engine.decks.B

  const [, setVer] = useState(0)
  useEffect(() => {
    const unA = deckA.subscribe(() => setVer(v => v + 1))
    const unB = deckB.subscribe(() => setVer(v => v + 1))
    const unE = engine.subscribe(() => setVer(v => v + 1))
    return () => {
      unA()
      unB()
      unE()
    }
  }, [deckA, deckB, engine])

  // Real-time time, master stereo VU meters, & 4-beat grid counter animation
  const timeARef = useRef<HTMLSpanElement>(null)
  const timeBRef = useRef<HTMLSpanElement>(null)
  const beatAEls = useRef<(HTMLDivElement | null)[]>([])
  const beatBEls = useRef<(HTMLDivElement | null)[]>([])
  const masterVuLRef = useRef<HTMLDivElement>(null)
  const masterVuRRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const dataL = new Float32Array(engine.masterAnalyserL.fftSize)
    const dataR = new Float32Array(engine.masterAnalyserR.fftSize)
    let peakL = 0
    let peakR = 0
    const segs = 12

    const tick = () => {
      raf = requestAnimationFrame(tick)
      // Time displays
      if (timeARef.current) {
        timeARef.current.textContent = `${formatMinutesSeconds(deckA.position)} / ${formatMinutesSeconds(deckA.duration)}`
      }
      if (timeBRef.current) {
        timeBRef.current.textContent = `${formatMinutesSeconds(deckB.position)} / ${formatMinutesSeconds(deckB.duration)}`
      }

      // Master Stereo VU meters
      if (engine.masterAnalyserL && engine.masterAnalyserR) {
        engine.masterAnalyserL.getFloatTimeDomainData(dataL)
        let sumL = 0
        for (let i = 0; i < dataL.length; i++) sumL += dataL[i] * dataL[i]
        const rmsL = Math.sqrt(sumL / dataL.length)
        peakL = Math.max(rmsL, peakL * 0.93)
        const litCountL = Math.min(segs, Math.round(peakL * segs * 2.2))

        engine.masterAnalyserR.getFloatTimeDomainData(dataR)
        let sumR = 0
        for (let i = 0; i < dataR.length; i++) sumR += dataR[i] * dataR[i]
        const rmsR = Math.sqrt(sumR / dataR.length)
        peakR = Math.max(rmsR, peakR * 0.93)
        const litCountR = Math.min(segs, Math.round(peakR * segs * 2.2))

        const elL = masterVuLRef.current
        if (elL) {
          for (let i = 0; i < segs; i++) {
            const seg = elL.children[i] as HTMLElement | undefined
            if (seg) seg.style.opacity = i < litCountL ? '1' : '0.15'
          }
        }
        const elR = masterVuRRef.current
        if (elR) {
          for (let i = 0; i < segs; i++) {
            const seg = elR.children[i] as HTMLElement | undefined
            if (seg) seg.style.opacity = i < litCountR ? '1' : '0.15'
          }
        }
      }

      // 4-beat bar counter based on track beat grid.
      //
      // Driven by the *audible* position, not the read head. The window here is 0.04 of a
      // beat, and a keylocked deck's sound runs ~0.27 of a beat behind its read head, so
      // counting off the read head would light the next beat about a quarter beat before
      // you hear it. See DeckEngine.audiblePosition.
      const gridA = deckA.track?.grid
      if (gridA && deckA.track) {
        const activeIdxA = beatInBarAt(gridA, deckA.audiblePosition, 0.04)

        for (let i = 0; i < 4; i++) {
          const el = beatAEls.current[i]
          if (el) {
            const isCurrent = (deckA.playing || deckA.position > 0) && activeIdxA === i
            el.style.backgroundColor = isCurrent ? '#00d284' : '#161616'
            el.style.borderColor = isCurrent ? '#00d284' : '#2a2d33'
            el.style.opacity = isCurrent ? '1' : '0.4'
          }
        }
      } else {
        for (let i = 0; i < 4; i++) {
          const el = beatAEls.current[i]
          if (el) {
            el.style.backgroundColor = '#161616'
            el.style.borderColor = '#2a2d33'
            el.style.opacity = '0.3'
          }
        }
      }

      const gridB = deckB.track?.grid
      if (gridB && deckB.track) {
        const activeIdxB = beatInBarAt(gridB, deckB.audiblePosition, 0.04)

        for (let i = 0; i < 4; i++) {
          const el = beatBEls.current[i]
          if (el) {
            const isCurrent = (deckB.playing || deckB.position > 0) && activeIdxB === i
            el.style.backgroundColor = isCurrent ? '#a855f7' : '#161616'
            el.style.borderColor = isCurrent ? '#a855f7' : '#2a2d33'
            el.style.opacity = isCurrent ? '1' : '0.4'
          }
        }
      } else {
        for (let i = 0; i < 4; i++) {
          const el = beatBEls.current[i]
          if (el) {
            el.style.backgroundColor = '#161616'
            el.style.borderColor = '#2a2d33'
            el.style.opacity = '0.3'
          }
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deckA, deckB, engine])

  const masterBpm =
    (deckA.playing && !deckB.playing ? deckA.effectiveBpm : null) ??
    (deckB.playing && !deckA.playing ? deckB.effectiveBpm : null) ??
    engine.masterBpm ??
    deckA.effectiveBpm ??
    deckB.effectiveBpm ??
    (deckA.track?.bpm ?? deckB.track?.bpm ?? 128)

  return (
    <div className="w-full bg-[#1C1C1C] px-3 pt-2 pb-1.5 border-b border-[#23252a] text-white select-none">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-end gap-4 w-full mx-auto">
        {/* ================= LEFT: DECK A INFO & MINI WAVEFORM ================= */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Artwork thumbnail */}
          <div
            onClick={() => onLoadTrackClick?.('A')}
            className="relative h-10 w-10 shrink-0 rounded-[3px] overflow-hidden bg-[#161616] border border-[#2a2d33] cursor-pointer group shadow-sm"
            title="Deck A Artwork (Click to load track)"
          >
            {deckA.track?.coverUrl ? (
              <img
                src={deckA.track.coverUrl}
                alt=""
                className="h-full w-full object-cover group-hover:opacity-75 transition-opacity"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-xs font-bold text-[#10b981]">
                A
              </div>
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[9px] text-white font-medium transition-opacity">
              Load
            </div>
          </div>

          {/* Track title, artist, genre */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="truncate text-[12px] font-semibold text-white leading-tight">
                {deckA.track ? deckA.track.title : 'Deck A: No track loaded'}
              </h3>
              <span ref={timeARef} className="shrink-0 font-sans text-[11px] text-zinc-300 tabular-nums">
                0:00 / 0:00
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-1 text-[10px] text-[#8e929b] mt-0.5">
              <p className="truncate">
                {deckA.track
                  ? `${deckA.track.artist}${deckA.track.genre ? ` • ${deckA.track.genre}` : ''}${deckA.track.label ? ` • ${deckA.track.label}` : ''}`
                  : 'Drop audio file or click artwork to load'}
              </p>
              <div className="shrink-0 font-sans font-medium text-[#8e929b]">
                {deckA.effectiveBpm ? deckA.effectiveBpm.toFixed(0) : '---'}
                {deckA.track?.key ? (
                  <>
                    <span> / </span>
                    {deckA.keyShift !== 0 ? (
                      <>
                        <span
                          className="font-semibold"
                          style={{ color: camelotColor(shiftCamelot(deckA.track.key.camelot, deckA.keyShift)) }}
                          title={`Key shifted by ${deckA.keyShift > 0 ? `+${deckA.keyShift}` : deckA.keyShift} st (Original: ${deckA.track.key.camelot})`}
                        >
                          {shiftCamelot(deckA.track.key.camelot, deckA.keyShift)}
                        </span>{' '}
                        <span
                          className="text-amber-400 font-semibold"
                          title={`Key shifted by ${deckA.keyShift > 0 ? `+${deckA.keyShift}` : deckA.keyShift} semitones`}
                        >
                          {deckA.keyShift > 0 ? `+${deckA.keyShift}` : deckA.keyShift}
                        </span>
                      </>
                    ) : (
                      <span
                        className="font-semibold"
                        style={{ color: camelotColor(deckA.track.key.camelot) }}
                        title={`Key: ${deckA.track.key.camelot}`}
                      >
                        {deckA.track.key.camelot}
                      </span>
                    )}
                  </>
                ) : ''}
              </div>
            </div>

            {/* Mini Waveform Deck A */}
            <div className="mt-1">
              <MiniWaveform deck={deckA} waveColor="#10b981" />
            </div>
          </div>
        </div>

        {/* ================= CENTER: MASTER SECTION & BEATCOUNTER ================= */}
        <div className="flex flex-col items-center justify-between px-2 shrink-0">
          {/* Top: Master Volume Knob & Master BPM Display Field, centered */}
          <div className="flex items-center justify-center gap-2 mb-1">
            {/* Master Volume Knob */}
            <div className="flex items-center" title="Master Volume / Gain">
              <Knob
                size={20}
                min={0}
                max={2}
                value={engine.masterVolume}
                defaultValue={1}
                onValueChange={v => engine.setMasterVolume(v)}
                accentColor="#ffffff"
                format={v => `${Math.round(v * 100)}%`}
              />
            </div>

            {/* Master BPM Display Field (styled like range display field) */}
            <div
              className="h-5 min-w-[42px] px-2 rounded-[2px] bg-[#161616] border border-[#2a2d33] font-sans text-[10px] font-bold text-zinc-300 tabular-nums hover:text-white transition-colors tracking-wider select-none flex items-center justify-center leading-none shadow-inner"
              title="Master Tempo (BPM)"
            >
              {masterBpm ? masterBpm.toFixed(2) : '128.00'}
            </div>
          </div>

          {/* Bottom: The two rows of VU-Meter and Beatcounter */}
          <div className="flex flex-col gap-1 items-center">
            {/* Row 1: Horizontal Stereo VU-meter bar */}
            <div
              className="w-32 h-5 rounded-[2px] bg-[#161616] border border-[#2a2d33] flex flex-col justify-between p-[2px] gap-[1.5px]"
              title="Master Stereo VU Meter (L / R)"
            >
              {/* L Channel */}
              <div ref={masterVuLRef} className="grid grid-cols-12 gap-[1.5px] h-[5px] w-full">
                {Array.from({ length: 12 }, (_, i) => {
                  const isRed = i >= 10
                  const isYellow = i >= 6 && i < 10
                  const color = isRed ? '#ef4444' : isYellow ? '#f59e0b' : '#10b981'
                  return (
                    <div
                      key={i}
                      className="h-full rounded-[0.5px] transition-opacity duration-75"
                      style={{ backgroundColor: color, opacity: 0.15 }}
                    />
                  )
                })}
              </div>

              {/* R Channel */}
              <div ref={masterVuRRef} className="grid grid-cols-12 gap-[1.5px] h-[5px] w-full">
                {Array.from({ length: 12 }, (_, i) => {
                  const isRed = i >= 10
                  const isYellow = i >= 6 && i < 10
                  const color = isRed ? '#ef4444' : isYellow ? '#f59e0b' : '#10b981'
                  return (
                    <div
                      key={i}
                      className="h-full rounded-[0.5px] transition-opacity duration-75"
                      style={{ backgroundColor: color, opacity: 0.15 }}
                    />
                  )
                })}
              </div>
            </div>

            {/* Row 2: Beat grid counter (Metronome 4-beat bar indicator for Deck A & Deck B) */}
            <div
              className="w-32 h-5 rounded-[2px] bg-[#161616] border border-[#2a2d33] flex flex-col justify-between p-[2px] gap-[1.5px]"
              title="Deck A & B 4-Beat Grid Position"
            >
              {/* Deck A 4-beat row */}
              <div className="grid grid-cols-4 gap-[2px] h-[5.5px] w-full" title="Deck A 4-Beat Grid Position">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    ref={el => {
                      beatAEls.current[i] = el
                    }}
                    className="h-full rounded-[1px] bg-[#161616] border border-[#252830] transition-colors duration-75"
                  />
                ))}
              </div>
              {/* Deck B 4-beat row */}
              <div className="grid grid-cols-4 gap-[2px] h-[5.5px] w-full" title="Deck B 4-Beat Grid Position">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    ref={el => {
                      beatBEls.current[i] = el
                    }}
                    className="h-full rounded-[1px] bg-[#161616] border border-[#252830] transition-colors duration-75"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ================= RIGHT: DECK B INFO & MINI WAVEFORM ================= */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Track title, artist, genre */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="truncate text-[12px] font-semibold text-white leading-tight">
                {deckB.track ? deckB.track.title : 'Deck B: No track loaded'}
              </h3>
              <span ref={timeBRef} className="shrink-0 font-sans text-[11px] text-zinc-300 tabular-nums">
                0:00 / 0:00
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-1 text-[10px] text-[#8e929b] mt-0.5">
              <p className="truncate">
                {deckB.track
                  ? `${deckB.track.artist}${deckB.track.genre ? ` • ${deckB.track.genre}` : ''}${deckB.track.label ? ` • ${deckB.track.label}` : ''}`
                  : 'Drop audio file or click artwork to load'}
              </p>
              <div className="shrink-0 font-sans font-medium text-[#8e929b]">
                {deckB.effectiveBpm ? deckB.effectiveBpm.toFixed(0) : '---'}
                {deckB.track?.key ? (
                  <>
                    <span> / </span>
                    {deckB.keyShift !== 0 ? (
                      <>
                        <span
                          className="font-semibold"
                          style={{ color: camelotColor(shiftCamelot(deckB.track.key.camelot, deckB.keyShift)) }}
                          title={`Key shifted by ${deckB.keyShift > 0 ? `+${deckB.keyShift}` : deckB.keyShift} st (Original: ${deckB.track.key.camelot})`}
                        >
                          {shiftCamelot(deckB.track.key.camelot, deckB.keyShift)}
                        </span>{' '}
                        <span
                          className="text-amber-400 font-semibold"
                          title={`Key shifted by ${deckB.keyShift > 0 ? `+${deckB.keyShift}` : deckB.keyShift} semitones`}
                        >
                          {deckB.keyShift > 0 ? `+${deckB.keyShift}` : deckB.keyShift}
                        </span>
                      </>
                    ) : (
                      <span
                        className="font-semibold"
                        style={{ color: camelotColor(deckB.track.key.camelot) }}
                        title={`Key: ${deckB.track.key.camelot}`}
                      >
                        {deckB.track.key.camelot}
                      </span>
                    )}
                  </>
                ) : ''}
              </div>
            </div>

            {/* Mini Waveform Deck B */}
            <div className="mt-1">
              <MiniWaveform deck={deckB} waveColor="#a855f7" />
            </div>
          </div>

          {/* Artwork thumbnail */}
          <div
            onClick={() => onLoadTrackClick?.('B')}
            className="relative h-10 w-10 shrink-0 rounded-[3px] overflow-hidden bg-[#161616] border border-[#2a2d33] cursor-pointer group shadow-sm"
            title="Deck B Artwork (Click to load track)"
          >
            {deckB.track?.coverUrl ? (
              <img
                src={deckB.track.coverUrl}
                alt=""
                className="h-full w-full object-cover group-hover:opacity-75 transition-opacity"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-xs font-bold text-[#a855f7]">
                B
              </div>
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[9px] text-white font-medium transition-opacity">
              Load
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
