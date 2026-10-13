import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { MiniWaveform } from './MiniWaveform'
import { BeatCounter } from './BeatCounter'
import { camelotColor, shiftCamelot } from '@/lib/camelot'
import { Knob } from './Knob'

interface TraktorMiddleStripProps {
  engine: AudioEngine
  onLoadTrackClick?: (deckId: 'A' | 'B') => void
  onToggleFx?: (deckId: 'A' | 'B') => void
  activeFxDeck?: 'A' | 'B' | null
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

const CAMELOT_KEYS = [
  '1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
  '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B',
]

export function TraktorMiddleStrip({
  engine,
  onLoadTrackClick,
  onToggleFx,
  activeFxDeck,
}: TraktorMiddleStripProps) {
  const deckA = engine.decks.A
  const deckB = engine.decks.B
  const [isEditingMasterBpm, setIsEditingMasterBpm] = useState(false)
  const [, setVer] = useState(0)

  const timeAEl = useRef<HTMLSpanElement>(null)
  const timeBEl = useRef<HTMLSpanElement>(null)

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

  // Real-time time display loop without re-rendering entire component
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (timeAEl.current && deckA.track) {
        timeAEl.current.textContent = `${formatTime(deckA.position)} / ${formatTime(deckA.duration)}`
      } else if (timeAEl.current) {
        timeAEl.current.textContent = '0:00 / 0:00'
      }

      if (timeBEl.current && deckB.track) {
        timeBEl.current.textContent = `${formatTime(deckB.position)} / ${formatTime(deckB.duration)}`
      } else if (timeBEl.current) {
        timeBEl.current.textContent = '0:00 / 0:00'
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deckA, deckB])

  const masterBpm =
    deckA.effectiveBpm || deckB.effectiveBpm || (deckA.track?.bpm ?? deckB.track?.bpm ?? 128)

  return (
    <div className="w-full bg-[#1C1C1C] px-3 py-2 border-b border-[#282828] text-white select-none">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 w-full">
        {/* ================= LEFT: DECK A INFO & OVERVIEW ================= */}
        <DeckHeader
          deck={deckA}
          deckId="A"
          accentColor="#34d399"
          timeRef={timeAEl}
          onLoadClick={() => onLoadTrackClick?.('A')}
          side="left"
        />

        {/* ================= CENTER: MASTER BPM, BEAT COUNTER & FX ================= */}
        <div className="flex items-center gap-2.5 px-2.5 py-1 bg-[#161616] rounded-md border border-[#282828] shrink-0">
          {/* Master BPM & Gain */}
          <div className="flex items-center gap-1.5 pr-2 border-r border-[#282828]">
            <div className="flex flex-col items-center">
              <span className="text-[8px] font-semibold text-[#888888] uppercase tracking-wider">
                MST BPM
              </span>
              {isEditingMasterBpm ? (
                <input
                  type="number"
                  step="0.1"
                  autoFocus
                  defaultValue={masterBpm.toFixed(1)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const val = parseFloat((e.target as HTMLInputElement).value)
                      if (!isNaN(val) && val > 0) engine.setMasterBpm(val)
                      setIsEditingMasterBpm(false)
                    } else if (e.key === 'Escape') {
                      setIsEditingMasterBpm(false)
                    }
                  }}
                  onBlur={e => {
                    const val = parseFloat(e.target.value)
                    if (!isNaN(val) && val > 0) engine.setMasterBpm(val)
                    setIsEditingMasterBpm(false)
                  }}
                  className="w-12 bg-black border border-white text-white font-mono text-xs font-bold text-center rounded px-0.5 outline-none"
                />
              ) : (
                <span
                  onClick={() => setIsEditingMasterBpm(true)}
                  className="text-xs font-mono font-bold text-[#d4d4d4] hover:text-white hover:underline cursor-pointer tabular-nums"
                  title="Click to overrule Master BPM"
                >
                  {masterBpm.toFixed(1)}
                </span>
              )}
            </div>
            <div className="flex items-center" title="Master Volume / Gain">
              <Knob
                size={18}
                min={0}
                max={1}
                defaultValue={0.9}
                value={engine.masterVolume}
                onValueChange={v => engine.setMasterVolume(v)}
                accentColor="#34d399"
              />
            </div>
          </div>

          {/* Beat Counter (4-Beat Metronome Bar Steps for Deck A & Deck B) */}
          <div className="w-28 shrink-0">
            <BeatCounter deckA={deckA} deckB={deckB} />
          </div>

          {/* FX A & B Toggle Buttons */}
          <div className="flex items-center gap-1 pl-1 border-l border-[#282828]">
            <button
              type="button"
              onClick={() => onToggleFx?.('A')}
              className={`px-2 py-1 text-[9px] font-bold rounded border transition-colors ${
                activeFxDeck === 'A'
                  ? 'bg-[#141414] text-white border-white shadow-[0_0_6px_rgba(255,255,255,0.25)]'
                  : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
              title="Toggle Deck A FX panel"
            >
              FX 1
            </button>
            <button
              type="button"
              onClick={() => onToggleFx?.('B')}
              className={`px-2 py-1 text-[9px] font-bold rounded border transition-colors ${
                activeFxDeck === 'B'
                  ? 'bg-[#141414] text-white border-white shadow-[0_0_6px_rgba(255,255,255,0.25)]'
                  : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
              title="Toggle Deck B FX panel"
            >
              FX 2
            </button>
          </div>
        </div>

        {/* ================= RIGHT: DECK B INFO & OVERVIEW ================= */}
        <DeckHeader
          deck={deckB}
          deckId="B"
          accentColor="#a855f7"
          timeRef={timeBEl}
          onLoadClick={() => onLoadTrackClick?.('B')}
          side="right"
        />
      </div>
    </div>
  )
}

function DeckHeader({
  deck,
  deckId,
  accentColor,
  timeRef,
  onLoadClick,
  side,
}: {
  deck: DeckEngine
  deckId: 'A' | 'B'
  accentColor: string
  timeRef: React.RefObject<HTMLSpanElement>
  onLoadClick: () => void
  side: 'left' | 'right'
}) {
  const [isEditingBpm, setIsEditingBpm] = useState(false)
  const [isEditingKey, setIsEditingKey] = useState(false)

  return (
    <div
      className={`flex items-center gap-2.5 min-w-0 ${
        side === 'right' ? 'flex-row-reverse text-right' : 'text-left'
      }`}
    >
      {/* Artwork Square */}
      <div
        onClick={onLoadClick}
        className="relative h-10 w-10 shrink-0 rounded-[3px] overflow-hidden bg-[#161616] border border-[#282828] cursor-pointer group shadow-sm"
        title={`Deck ${deckId} Artwork (Click to load track)`}
      >
        {deck.track?.coverUrl ? (
          <img
            src={deck.track.coverUrl}
            alt=""
            className="h-full w-full object-cover group-hover:opacity-75 transition-opacity"
          />
        ) : (
          <div
            className="h-full w-full flex items-center justify-center text-xs font-bold"
            style={{ color: accentColor }}
          >
            {deckId}
          </div>
        )}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <span className="text-[8px] font-bold uppercase tracking-wider text-white">Load</span>
        </div>
      </div>

      {/* Track Info (Title, Artist, BPM, Camelot Key) */}
      <div className="flex-1 min-w-0">
        <div className={`flex items-baseline justify-between gap-1.5 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
          <h2
            onClick={onLoadClick}
            className="text-[12px] font-bold text-white truncate cursor-pointer hover:text-zinc-300"
            title={deck.track ? `${deck.track.title} - ${deck.track.artist}` : 'Click to load track'}
          >
            {deck.track ? deck.track.title : `Deck ${deckId}: No track loaded`}
          </h2>
          <span ref={timeRef} className="text-[10px] font-mono text-zinc-300 tabular-nums shrink-0">
            0:00 / 0:00
          </span>
        </div>

        <div className={`flex items-baseline justify-between gap-1 text-[10px] text-zinc-400 mt-0.5 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
          <p className="truncate text-zinc-400">
            {deck.track
              ? `${deck.track.artist}${deck.track.genre ? ` • ${deck.track.genre}` : ''}`
              : 'Drop audio file or click artwork'}
          </p>

          {/* BPM & Color-coded Key Display */}
          <div className="shrink-0 font-sans font-medium text-zinc-300 flex items-center gap-0.5">
            {isEditingBpm ? (
              <input
                type="number"
                step="0.1"
                autoFocus
                defaultValue={deck.effectiveBpm ? deck.effectiveBpm.toFixed(1) : ''}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = parseFloat((e.target as HTMLInputElement).value)
                    if (!isNaN(val) && val > 0) deck.setTrackBpm(val)
                    setIsEditingBpm(false)
                  } else if (e.key === 'Escape') {
                    setIsEditingBpm(false)
                  }
                }}
                onBlur={e => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val) && val > 0) deck.setTrackBpm(val)
                  setIsEditingBpm(false)
                }}
                className="w-12 bg-black border border-white text-white font-mono text-[10px] font-bold text-center rounded px-0.5 outline-none"
              />
            ) : (
              <span
                onClick={() => {
                  if (deck.track) setIsEditingBpm(true)
                }}
                className={`font-semibold text-white ${
                  deck.track ? 'hover:underline hover:text-accent cursor-pointer' : ''
                }`}
                title={deck.track ? 'Click to overrule BPM' : undefined}
              >
                {deck.effectiveBpm ? deck.effectiveBpm.toFixed(1) : '---'}
              </span>
            )}
            {deck.track ? (
              <>
                <span className="text-zinc-500"> / </span>
                {isEditingKey ? (
                  <select
                    autoFocus
                    value={
                      deck.keyShift !== 0
                        ? shiftCamelot(deck.track.key?.camelot || '8A', deck.keyShift)
                        : deck.track.key?.camelot || '8A'
                    }
                    onChange={e => {
                      deck.setTrackKey(e.target.value)
                      if (deck.keyShift !== 0) deck.resetKeyShift()
                      setIsEditingKey(false)
                    }}
                    onBlur={() => setIsEditingKey(false)}
                    className="bg-black border border-white text-white text-[10px] font-bold font-mono rounded px-0.5 outline-none cursor-pointer"
                  >
                    {CAMELOT_KEYS.map(k => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    onClick={() => setIsEditingKey(true)}
                    className="font-bold cursor-pointer hover:underline"
                    style={{
                      color: camelotColor(
                        deck.keyShift !== 0
                          ? shiftCamelot(deck.track.key?.camelot || '8A', deck.keyShift)
                          : deck.track.key?.camelot || '8A'
                      ),
                    }}
                    title="Click to overrule Camelot Key"
                  >
                    {deck.keyShift !== 0
                      ? shiftCamelot(deck.track.key?.camelot || '8A', deck.keyShift)
                      : deck.track.key?.camelot || '---'}
                    {deck.keyShift !== 0 && (
                      <span className="text-amber-400 font-semibold text-[9px] ml-1">
                        {deck.keyShift > 0 ? `+${deck.keyShift}` : deck.keyShift}
                      </span>
                    )}
                  </span>
                )}
              </>
            ) : null}
          </div>
        </div>

        {/* Mini Waveform Overview Strip */}
        <div className="mt-1">
          <MiniWaveform deck={deck} waveColor={accentColor} />
        </div>
      </div>
    </div>
  )
}
