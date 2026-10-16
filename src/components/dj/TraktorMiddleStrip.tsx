import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { MiniWaveform } from './MiniWaveform'
import { BeatCounter } from './BeatCounter'
import { camelotToOpenKey, shiftCamelot } from '@/lib/camelot'
import { CAMELOT_BLOCK_SM, camelotBlockStyle } from '@/components/badges'
import { CAMELOT_TO_KEY } from '@/types/track'
import { shortKey } from '@/lib/format'
import { readWheelMode, writeWheelMode, type WheelMode } from '@/lib/wheelMode'
import { Knob } from './Knob'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'
// import { MixRenderButton } from './MixRenderButton'
import { youtubeThumbUrl } from '@/lib/youtube'

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

function formatKeyDisplay(camelot: string, mode: WheelMode): string {
  if (!camelot) return '---'
  if (mode === 'openkey') {
    return camelotToOpenKey(camelot) || camelot
  }
  if (mode === 'musical') {
    const full = CAMELOT_TO_KEY[camelot]
    return full ? shortKey(full) : camelot
  }
  return camelot
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
  const [keyMode, setKeyMode] = useState<WheelMode>(readWheelMode)
  const [, setVer] = useState(0)

  const handleKeyModeChange = (mode: WheelMode) => {
    setKeyMode(mode)
    writeWheelMode(mode)
  }

  const timeAEl = useRef<HTMLSpanElement>(null)
  const timeBEl = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const unE = engine.subscribe(() => setVer(v => v + 1))
    const unA = deckA.subscribe(() => setVer(v => v + 1))
    const unB = deckB.subscribe(() => setVer(v => v + 1))
    const unY = youtubeBridge.subscribe(() => setVer(v => v + 1))
    return () => {
      unE()
      unA()
      unB()
      unY()
    }
  }, [engine, deckA, deckB])

  // Real-time time display loop without re-rendering entire component
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (timeAEl.current) {
        if (deckA.track) {
          timeAEl.current.textContent = `${formatTime(deckA.position)} / ${formatTime(deckA.duration)}`
        } else if (youtubeBridge.state.A.hasVideo) {
          timeAEl.current.textContent = `${formatTime(youtubeBridge.state.A.currentTime)} / ${formatTime(youtubeBridge.state.A.duration)}`
        } else {
          timeAEl.current.textContent = '0:00 / 0:00'
        }
      }

      if (timeBEl.current) {
        if (deckB.track) {
          timeBEl.current.textContent = `${formatTime(deckB.position)} / ${formatTime(deckB.duration)}`
        } else if (youtubeBridge.state.B.hasVideo) {
          timeBEl.current.textContent = `${formatTime(youtubeBridge.state.B.currentTime)} / ${formatTime(youtubeBridge.state.B.duration)}`
        } else {
          timeBEl.current.textContent = '0:00 / 0:00'
        }
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deckA, deckB])

  const masterBpm =
    (deckA.playing && !deckB.playing ? deckA.effectiveBpm : null) ??
    (deckB.playing && !deckA.playing ? deckB.effectiveBpm : null) ??
    engine.masterBpm ??
    deckA.effectiveBpm ??
    deckB.effectiveBpm ??
    (deckA.track?.bpm ?? deckB.track?.bpm ?? 128)

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
          onToggleFx={() => onToggleFx?.('A')}
          fxActive={activeFxDeck === 'A'}
          side="left"
          keyMode={keyMode}
        />

        {/* ================= CENTER: MASTER BPM, BEAT COUNTER & KEY NOTATION ================= */}
        <div className="flex items-center gap-2.5 px-2.5 py-1 bg-[#161616] rounded-md border border-[#282828] shrink-0">
          {/* Master BPM & Gain (Left symmetrical wing) */}
          <div className="w-[96px] shrink-0 flex items-center justify-center gap-2 pr-2 border-r border-[#282828]">
            <div className="flex flex-col items-center">
              <span className="text-[7.5px] font-semibold text-[#888888] uppercase tracking-wider mb-0.5">
                MASTER BPM
              </span>
              {isEditingMasterBpm ? (
                <input
                  type="number"
                  step="0.01"
                  autoFocus
                  defaultValue={masterBpm.toFixed(2)}
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
                  className="w-14 bg-black border border-white text-white font-mono text-xs font-bold text-center rounded px-0.5 outline-none"
                />
              ) : (
                <span
                  onClick={() => setIsEditingMasterBpm(true)}
                  className="text-xs font-mono font-bold text-[#d4d4d4] hover:text-white hover:underline cursor-pointer tabular-nums"
                  title="Click to overrule Master BPM"
                >
                  {masterBpm.toFixed(2)}
                </span>
              )}
            </div>
            <div className="flex items-center pt-2" title="Master Volume / Gain">
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

          {/* S Button: Snap Mode */}
          <button
            type="button"
            onClick={() => engine.toggleSnapMode()}
            className={`h-[18px] w-[17px] shrink-0 rounded-[3px] border text-[8.5px] font-mono font-bold flex items-center justify-center transition-all select-none ${
              engine.snapMode
                ? 'bg-[#181818] border-[#444444] text-[#d4d4d4] hover:border-[#666666] hover:text-white'
                : 'bg-[#141414] border-[#242424] text-[#4a4a4a] hover:border-[#383838] hover:text-[#777777]'
            }`}
            title={`SNAP MODE (${engine.snapMode ? 'ON' : 'OFF'})\nSnaps to closest beat when setting cue points and loops.`}
          >
            S
          </button>

          {/* Beat Counter (4-Beat Metronome Bar Steps for Deck A & Deck B - EXACT CENTER) */}
          <div className="w-36 shrink-0 flex items-center justify-center px-1">
            <BeatCounter deckA={deckA} deckB={deckB} className="w-full" />
          </div>

          {/* Q Button: Quantize Mode */}
          <button
            type="button"
            onClick={() => engine.toggleQuantMode()}
            className={`h-[18px] w-[17px] shrink-0 rounded-[3px] border text-[8.5px] font-mono font-bold flex items-center justify-center transition-all select-none ${
              engine.quantMode
                ? 'bg-[#181818] border-[#444444] text-[#d4d4d4] hover:border-[#666666] hover:text-white'
                : 'bg-[#141414] border-[#242424] text-[#4a4a4a] hover:border-[#383838] hover:text-[#777777]'
            }`}
            title={`QUANT MODE (${engine.quantMode ? 'ON' : 'OFF'})\nEnables beat-accurate (quantized) skipping between cue points.`}
          >
            Q
          </button>

          {/* Key Notation Dropdown Selector (Right symmetrical wing) */}
          <div className="w-[96px] shrink-0 flex flex-col items-center justify-center pl-2 border-l border-[#282828]">
            <span className="text-[7.5px] font-semibold text-[#888888] uppercase tracking-wider mb-0.5">
              KEY NOTATION
            </span>
            <select
              value={keyMode}
              onChange={e => handleKeyModeChange(e.target.value as WheelMode)}
              className="h-5 w-full px-1 bg-[#141414] hover:bg-[#1a1a1a] border border-[#282828] hover:border-[#444444] rounded text-[10px] font-bold text-[#d4d4d4] focus:text-white focus:border-zinc-500 outline-none cursor-pointer transition-colors text-center"
              title="Key notation preference"
            >
              <option value="camelot" className="bg-[#141414] text-white">Camelot</option>
              <option value="musical" className="bg-[#141414] text-white">Musical</option>
              <option value="openkey" className="bg-[#141414] text-white">Open Key</option>
            </select>
          </div>

          {/* Capture + offline render to WAV - hidden for now */}
          {/* <MixRenderButton engine={engine} /> */}
        </div>

        {/* ================= RIGHT: DECK B INFO & OVERVIEW ================= */}
        <DeckHeader
          deck={deckB}
          deckId="B"
          accentColor="#a855f7"
          timeRef={timeBEl}
          onLoadClick={() => onLoadTrackClick?.('B')}
          onToggleFx={() => onToggleFx?.('B')}
          fxActive={activeFxDeck === 'B'}
          side="right"
          keyMode={keyMode}
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
  onToggleFx,
  fxActive,
  side,
  keyMode,
}: {
  deck: DeckEngine
  deckId: 'A' | 'B'
  accentColor: string
  timeRef: React.RefObject<HTMLSpanElement>
  onLoadClick: () => void
  onToggleFx?: () => void
  fxActive?: boolean
  side: 'left' | 'right'
  keyMode: WheelMode
}) {
  const [isEditingBpm, setIsEditingBpm] = useState(false)
  const [isEditingKey, setIsEditingKey] = useState(false)

  const ytState = youtubeBridge.state[deckId]
  const hasYt = ytState.hasVideo
  const rawCamelot = deck.track?.key?.camelot || (hasYt ? ytState.camelot : null)
  const effectiveCamelot = rawCamelot
    ? (deck.keyShift !== 0 ? shiftCamelot(rawCamelot, deck.keyShift) : rawCamelot)
    : null

  const displayTitle = deck.track ? deck.track.title : (hasYt ? ytState.title : `Deck ${deckId}: No track loaded`)
  const displayArtist = deck.track
    ? `${deck.track.artist}${deck.track.genre ? ` • ${deck.track.genre}` : ''}`
    : (hasYt ? (ytState.artist || 'YouTube Video') : 'Drop audio file or click artwork')
  const displayCover = deck.track?.coverUrl || (hasYt && ytState.videoId ? youtubeThumbUrl(ytState.videoId) : null)
  const displayBpm = deck.effectiveBpm ? deck.effectiveBpm : (hasYt ? ytState.bpm * ytState.playbackRate : null)
  const isLoaded = Boolean(deck.track || hasYt)

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
        {displayCover ? (
          <img
            src={displayCover}
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

      {/* Track Info (Title, Artist, BPM, Camelot/Musical/Open Key) */}
      <div className="flex-1 min-w-0">
        <div className={`flex items-center justify-between gap-1.5 h-[18px] ${side === 'right' ? 'flex-row-reverse' : ''}`}>
          <div className={`flex items-center gap-1.5 min-w-0 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
            <h2
              onClick={onLoadClick}
              className="text-[12px] font-bold text-white truncate cursor-pointer hover:text-zinc-300 leading-none"
              title={isLoaded ? `${displayTitle} - ${displayArtist}` : 'Click to load track'}
            >
              {displayTitle}
            </h2>
            {deck.fluxMode && (
              <span
                className="px-1 py-0.5 rounded-[2px] text-[7.5px] font-mono font-bold tracking-wider uppercase bg-emerald-950/80 text-emerald-400 border border-emerald-500 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.4)] shrink-0 leading-none"
                title="SLIP Mode is active: phrasing is preserved during cues, loops and FX"
              >
                SLIP
              </span>
            )}
            <button
              type="button"
              onClick={onToggleFx}
              className={`h-[14px] px-1 rounded-[2px] border text-[8px] font-bold uppercase tracking-wider transition-all shrink-0 ${
                fxActive
                  ? 'bg-[#141414] text-white border-white shadow-[0_0_6px_rgba(255,255,255,0.35)]'
                  : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
              }`}
              title={`Deck ${deckId} FX drawer`}
            >
              FX
            </button>
          </div>
          <span ref={timeRef} className="text-[10px] font-mono text-zinc-300 tabular-nums shrink-0 leading-none">
            0:00 / 0:00
          </span>
        </div>

        <div className={`flex items-center justify-between gap-1 text-[10px] text-zinc-400 mt-0.5 h-4 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
          <p className="truncate text-zinc-400">
            {displayArtist}
          </p>

          {/* BPM & Color-coded Key Display. The BPM and the key chip are separated by this row's
              own gap: a "/" used to sit between them, and the extra space is what it stood for.
              A literal space would not work — whitespace-only text between flex items is collapsed
              away, so the gap is the only thing that shows. */}
          <div className="shrink-0 font-sans font-medium text-zinc-300 flex items-center gap-1.5">
            {isEditingBpm ? (
              <input
                type="number"
                step="0.01"
                autoFocus
                // Edit base BPM (grid), not effective BPM — avoids double-applying pitch rate.
                defaultValue={deck.track?.bpm ? deck.track.bpm.toFixed(2) : ''}
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
                className="w-14 bg-black border border-white text-white font-mono text-[10px] font-bold text-center rounded px-0.5 outline-none"
              />
            ) : (
              <span
                onClick={() => {
                  if (deck.track) setIsEditingBpm(true)
                }}
                className={`font-semibold text-white ${
                  deck.track ? 'hover:underline hover:text-accent cursor-pointer' : ''
                }`}
                title={
                  deck.track
                    ? `Click to overrule base BPM (grid). Showing effective ${displayBpm?.toFixed(2) ?? '---'} BPM`
                    : undefined
                }
              >
                {displayBpm ? displayBpm.toFixed(2) : '---'}
              </span>
            )}
            {isLoaded ? (
              <>
                {isEditingKey && deck.track ? (
                  <select
                    autoFocus
                    value={effectiveCamelot || '8A'}
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
                        {keyMode === 'camelot'
                          ? k
                          : `${formatKeyDisplay(k, keyMode)} (${k})`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    {/* The key is the one field a DJ reads across the console, so it wears the same
                        Camelot chip as the tables and the key wheel at the dense size — the wheel's
                        own hue with dark ink, rather than tinted text. The label still follows the
                        global notation (Camelot / musical / Open Key). */}
                    <span
                      onClick={() => setIsEditingKey(true)}
                      className={`${CAMELOT_BLOCK_SM} cursor-pointer hover:brightness-110 ${
                        // A ring rather than a border: a 1px border would add 2px to the box and
                        // make the keyless chip 18px against the keyed chip's 16px.
                        effectiveCamelot ? '' : 'ring-1 ring-inset ring-[#333333] bg-[#1a1a1a] text-[#666666]'
                      }`}
                      style={effectiveCamelot ? camelotBlockStyle(effectiveCamelot) : undefined}
                      title={
                        effectiveCamelot
                          ? `Click to overrule Key (${effectiveCamelot} • ${CAMELOT_TO_KEY[effectiveCamelot] ?? ''})`
                          : 'Click to overrule Key'
                      }
                    >
                      {effectiveCamelot ? formatKeyDisplay(effectiveCamelot, keyMode) : '---'}
                    </span>
                    {/* The shift sits outside the chip: amber on the chip's dark-on-pale ink vanishes. */}
                    {deck.keyShift !== 0 && (
                      <span className="text-amber-400 font-semibold text-[9px]">
                        {deck.keyShift > 0 ? `+${deck.keyShift}` : deck.keyShift}
                      </span>
                    )}
                  </>
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
