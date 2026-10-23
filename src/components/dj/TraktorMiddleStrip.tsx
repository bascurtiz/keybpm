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
import { useCoverArt } from '@/lib/dj/cover-art'
import { ACTIVE, ACTIVE_KEY } from '@/lib/dj/control-state'

interface TraktorMiddleStripProps {
  engine: AudioEngine
  onLoadTrackClick?: (deckId: 'A' | 'B') => void
  onToggleFx?: (deckId: 'A' | 'B') => void
  activeFxDeck?: 'A' | 'B' | null
  /** Show the per-deck FX buttons. Off in the phone console, which has no FX drawer. */
  showFx?: boolean
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
  showFx = true,
}: TraktorMiddleStripProps) {
  const deckA = engine.decks.A
  const deckB = engine.decks.B
  const [isEditingMasterBpm, setIsEditingMasterBpm] = useState(false)
  const cancelledMasterBpmRef = useRef(false)
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
    // The strip is the console's darkest band, and each deck sits on it as its own
    // raised panel: the eye then reads two sources either side of one clock in the
    // middle, which is the console's actual signal path. See `DeckHeader`.
    //
    // No padding here any more. The 4 px it used to add showed as a #161616 outline
    // between the chassis edge and each deck header, which made the two panels look
    // inset in a frame instead of being the corners of the console. The deck panels
    // carry that padding themselves now and run to the chassis edge in #1C1C1C; only
    // the centre module still sits on #161616, so the band still reads as three parts.
    <div className="w-full bg-[#161616] border-b border-[#282828] text-white select-none">
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch w-full">
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
          showFx={showFx}
        />

        {/* ================= CENTER: MASTER TEMPO & KEY NOTATION OVER THE BAR COUNTER =================
            Two rows, not one: the master clock and the global notation are settings you
            glance at, while snap / bar / quantise are controls you hit. Stacking them
            keeps the module roughly square instead of a wide strip that squeezed both
            deck headers into a third of the console each. */}
        <div className={`flex shrink-0 flex-col items-center justify-center gap-1.5 ${showFx === false ? 'px-2' : 'px-4'} py-1`}>
          <div className={`flex items-center ${showFx === false ? 'gap-2.5' : 'gap-4'}`}>
            <div className="flex flex-col items-center">
              <span className="text-[8.5px] font-semibold text-[#888888] uppercase tracking-wider">
                MASTER BPM
              </span>
              <div className="mt-0.5 flex items-center gap-1.5">
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
                        cancelledMasterBpmRef.current = true
                        setIsEditingMasterBpm(false)
                      }
                    }}
                    onBlur={e => {
                      if (cancelledMasterBpmRef.current) {
                        cancelledMasterBpmRef.current = false
                        return
                      }
                      const val = parseFloat(e.target.value)
                      if (!isNaN(val) && val > 0) engine.setMasterBpm(val)
                      setIsEditingMasterBpm(false)
                    }}
                    className="w-16 bg-black border border-white text-white font-mono text-[14px] font-bold text-center rounded px-0.5 outline-none"
                  />
                ) : (
                  <span
                    onClick={() => setIsEditingMasterBpm(true)}
                    className="text-[16px] font-mono font-bold leading-none text-[#dcdcdc] hover:text-white hover:underline cursor-pointer tabular-nums"
                    title="Click to overrule Master BPM"
                  >
                    {masterBpm.toFixed(2)}
                  </span>
                )}
                <span title="Master Volume / Gain" className="flex items-center">
                  <Knob
                    size={22}
                    min={0}
                    max={1}
                    defaultValue={0.9}
                    value={engine.masterVolume}
                    onValueChange={v => engine.setMasterVolume(v)}
                    accentColor="#34d399"
                  />
                </span>
              </div>
            </div>

            {showFx !== false && <div className="h-8 w-px bg-[#252525]" />}

            <div className="flex flex-col items-center">
              <span className="text-[8.5px] font-semibold text-[#888888] uppercase tracking-wider">
                KEY NOTATION
              </span>
              <select
                value={keyMode}
                onChange={e => handleKeyModeChange(e.target.value as WheelMode)}
                className="mt-0.5 h-6 w-[88px] px-1.5 bg-[#141414] hover:bg-[#1a1a1a] border border-[#282828] hover:border-[#444444] rounded text-[11px] font-bold text-[#d4d4d4] focus:text-white focus:border-zinc-500 outline-none cursor-pointer transition-colors text-center"
                title="Key notation preference"
              >
                <option value="camelot" className="bg-[#141414] text-white">Camelot</option>
                <option value="musical" className="bg-[#141414] text-white">Musical</option>
                <option value="openkey" className="bg-[#141414] text-white">Open Key</option>
              </select>
            </div>
          </div>

          {/* Bar counter centred between the two modes it qualifies, so the buttons read
              as flanks of the beat that both decks are counted against. */}
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={() => engine.toggleSnapMode()}
              className={`h-6 w-6 shrink-0 rounded-[3px] border text-[10px] font-bold flex items-center justify-center transition-all select-none ${
                engine.snapMode
                  ? ACTIVE
                  : 'bg-[#141414] border-[#282828] text-[#777777] hover:border-[#444444] hover:text-[#d4d4d4]'
              }`}
              title={`SNAP MODE (${engine.snapMode ? 'ON' : 'OFF'})\nSnaps to closest beat when setting cue points and loops.`}
            >
              S
            </button>

            <div className="w-[142px] shrink-0">
              <BeatCounter deckA={deckA} deckB={deckB} className="w-full" />
            </div>

            <button
              type="button"
              onClick={() => engine.toggleQuantMode()}
              className={`h-6 w-6 shrink-0 rounded-[3px] border text-[10px] font-bold flex items-center justify-center transition-all select-none ${
                engine.quantMode
                  ? ACTIVE
                  : 'bg-[#141414] border-[#282828] text-[#777777] hover:border-[#444444] hover:text-[#d4d4d4]'
              }`}
              title={`QUANT MODE (${engine.quantMode ? 'ON' : 'OFF'})\nEnables beat-accurate (quantized) skipping between cue points.`}
            >
              Q
            </button>
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
          showFx={showFx}
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
  showFx,
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
  showFx?: boolean
}) {
  const [isEditingBpm, setIsEditingBpm] = useState(false)
  const cancelledBpmRef = useRef(false)
  const [isEditingKey, setIsEditingKey] = useState(false)

  const ytState = youtubeBridge.state[deckId]
  const hasYt = ytState.hasVideo
  const rawCamelot = deck.track?.key?.camelot || (hasYt ? ytState.camelot : null)
  const effectiveCamelot = rawCamelot
    ? (deck.keyShift !== 0 ? shiftCamelot(rawCamelot, deck.keyShift) : rawCamelot)
    : null

  const displayTitle = deck.track ? deck.track.title : (hasYt ? ytState.title : `Deck ${deckId}: No track loaded`)
  // Artist only. The genre that used to be appended here is in the tag strip on the
  // track page and the table; on the console it crowded the line that has to be read
  // at a glance, and the deck header is about *which record* is loaded.
  const displayArtist = deck.track
    ? deck.track.artist
    : (hasYt ? (ytState.artist || 'YouTube Video') : 'Drop audio file or click artwork')
  const isLoaded = Boolean(deck.track || hasYt)
  const displayCover = useCoverArt(deck.track, hasYt ? ytState.videoId : null)
  const displayBpm = deck.effectiveBpm ? deck.effectiveBpm : (hasYt ? ytState.bpm * ytState.playbackRate : null)

  return (
    // One panel per deck. The artwork square always sits on the *outer* edge — the two
    // decks face the centre, where the shared clock is — while everything that is text
    // stays left-to-right on both sides: a mirrored title line reads backwards down the
    // console, and the deck you are not looking at is the one you need at a glance.
    <div
      className={`flex min-w-0 items-center gap-3 bg-[#1C1C1C] px-3.5 py-3 ${
        side === 'right' ? 'flex-row-reverse' : ''
      }`}
    >
      {/* Artwork Square */}
      <div
        onClick={onLoadClick}
        className="relative h-[50px] w-[50px] shrink-0 rounded-[4px] overflow-hidden bg-[#161616] border border-[#282828] cursor-pointer group shadow-sm"
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
            className="h-full w-full flex items-center justify-center text-sm font-bold"
            style={{ color: accentColor }}
          >
            {deckId}
          </div>
        )}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <span className="text-[9px] font-bold uppercase tracking-wider text-white">Load</span>
        </div>
      </div>

      {/* Track Info (Title, FX, Time, BPM, Key, Artist, Mini Waveform) */}
      <div className="min-w-0 flex-1">
        {/* Row 1: Title (left) | FX, Time (right) */}
        <div className="flex h-5 items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5 flex-1">
            <h2
              onClick={onLoadClick}
              className="text-[15px] font-bold text-white truncate cursor-pointer hover:text-zinc-300 leading-none"
              title={isLoaded ? `${displayTitle} - ${displayArtist}` : 'Click to load track'}
            >
              {displayTitle}
            </h2>
            {deck.fluxMode && (
              <span
                className={`h-[17px] px-1.5 rounded-[3px] border text-[8.5px] font-bold uppercase tracking-wider shrink-0 leading-none flex items-center justify-center select-none animate-pulse ${ACTIVE_KEY}`}
                title="SLIP Mode is active: phrasing is preserved during cues, loops and FX"
              >
                SLIP
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {showFx !== false && (
              <button
                type="button"
                onClick={onToggleFx}
                className={`h-[17px] px-1.5 rounded-[3px] border text-[8.5px] font-bold uppercase tracking-wider transition-all shrink-0 ${
                  fxActive || (deck.fxType !== 'off' && deck.fxWet > 0)
                    ? `${ACTIVE_KEY} animate-pulse`
                    : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
                }`}
                title={`Deck ${deckId} FX: ${deck.fxType !== 'off' && deck.fxWet > 0 ? `${deck.fxType.toUpperCase()} active` : 'Click to toggle FX drawer'}`}
              >
                FX
              </button>
            )}
            <span ref={timeRef} className="text-[11.5px] font-mono text-zinc-300 tabular-nums shrink-0 leading-none">
              0:00 / 0:00
            </span>
          </div>
        </div>

        {/* Row 2: Artist (left) | BPM, Key (right) */}
        <div className="mt-1 flex h-[18px] items-center justify-between gap-1 text-zinc-400">
          <p className="truncate text-zinc-400 font-medium text-[12.5px] flex-1 min-w-0">
            {displayArtist}
          </p>

          {isLoaded && (
            <div className="flex shrink-0 items-center gap-2 font-sans">
              {isEditingBpm ? (
                <input
                  type="number"
                  step="0.01"
                  autoFocus
                  defaultValue={deck.track?.bpm ? deck.track.bpm.toFixed(2) : ''}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const val = parseFloat((e.target as HTMLInputElement).value)
                      if (!isNaN(val) && val > 0) deck.setTrackBpm(val)
                      setIsEditingBpm(false)
                    } else if (e.key === 'Escape') {
                      cancelledBpmRef.current = true
                      setIsEditingBpm(false)
                    }
                  }}
                  onBlur={e => {
                    if (cancelledBpmRef.current) {
                      cancelledBpmRef.current = false
                      return
                    }
                    const val = parseFloat(e.target.value)
                    if (!isNaN(val) && val > 0) deck.setTrackBpm(val)
                    setIsEditingBpm(false)
                  }}
                  className="w-14 bg-black border border-white text-white font-mono text-[11px] font-bold text-center rounded px-0.5 outline-none"
                />
              ) : (
                <span
                  onClick={() => {
                    if (deck.track) setIsEditingBpm(true)
                  }}
                  className={`font-bold text-white font-mono text-[13px] tabular-nums leading-none ${
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
                  className="bg-black border border-white text-white text-[10px] font-bold font-sans rounded px-0.5 outline-none cursor-pointer"
                >
                  {CAMELOT_KEYS.map(k => (
                    <option key={k} value={k}>
                      {keyMode === 'camelot' ? k : `${formatKeyDisplay(k, keyMode)} (${k})`}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center gap-1">
                  <span
                    onClick={() => setIsEditingKey(true)}
                    className={`${CAMELOT_BLOCK_SM} cursor-pointer hover:brightness-110 ${
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
                  {deck.keyShift !== 0 && (
                    <button
                      type="button"
                      onClick={() => deck.resetKeyShift()}
                      className="h-[17px] min-w-[18px] px-1 bg-[#101010] border border-[#282828] rounded-[3px] font-mono text-[9px] font-bold leading-none text-white flex items-center justify-center shrink-0 select-none cursor-pointer hover:border-[#444444] transition-colors shadow-inner"
                      title={`Key shifted by ${deck.keyShift > 0 ? `+${deck.keyShift}` : deck.keyShift} semitones (click to reset)`}
                    >
                      {deck.keyShift > 0 ? `+${deck.keyShift}` : deck.keyShift}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 3: Mini Waveform Overview Strip */}
        <div className="mt-1">
          <MiniWaveform deck={deck} waveColor={accentColor} />
        </div>
      </div>
    </div>
  )
}
