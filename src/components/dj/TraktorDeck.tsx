import { useEffect, useRef, useState } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { JogWheel } from './JogWheel'
import { Fader } from './Fader'
import { shiftCamelot, findKeySyncShift, areKeysCompatible } from '@/lib/camelot'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'
import { useViewportMode } from '@/lib/use-viewport'
import { CONTROL_W, CONTROL_H } from '@/lib/dj/control-size'
import { ACTIVE, ACTIVE_KEY } from '@/lib/dj/control-state'

interface TraktorDeckProps {
  deck: DeckEngine
  otherDeck: DeckEngine
  deckId: 'A' | 'B'
  side: 'left' | 'right'
  accentColor: string
  onLoadClick?: () => void
}

/**
 * The pitch fader's travel, fixed at ±10 %.
 *
 * The column used to carry a range key that cycled ±6 / ±10 / ±16 / ±100 %, with a number
 * underneath the − / + pair to say which was armed. On a console this size the 6 % and 16 %
 * steps were indistinguishable on a 140 px throw, the ±100 % setting turned the fader into a
 * switch, and the number itself was the only control on the row that stated a *setting* rather
 * than an action — so it read as a readout you had to decode before touching the fader. ±10 %
 * is the range DJs actually mix in, so it is the only one left: the fader's ends now mean
 * something without a label, and the space goes back to the − / + pair.
 */
const PITCH_RANGE = 10

export function TraktorDeck({
  deck,
  otherDeck,
  deckId,
  side,
  accentColor,
  onLoadClick: _onLoadClick,
}: TraktorDeckProps) {
  const { kiosk } = useViewportMode()
  const [, setVer] = useState(0)
  const [activeNudge, setActiveNudge] = useState<-1 | 0 | 1>(0)
  const nudgeIntervalRef = useRef<number | null>(null)

  useEffect(() => {
    const unsub = deck.subscribe(() => setVer(v => v + 1))
    return () => {
      unsub()
      if (nudgeIntervalRef.current) clearInterval(nudgeIntervalRef.current)
      deck.nudge(0)
    }
  }, [deck])

  const handleNudgeStart = (dir: -1 | 1, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {}
    setActiveNudge(dir)
    deck.nudge(dir)

    if (!deck.playing) {
      if (nudgeIntervalRef.current) clearInterval(nudgeIntervalRef.current)
      nudgeIntervalRef.current = window.setInterval(() => {
        deck.nudge(dir)
      }, 100)
    }
  }

  const handleNudgeEnd = (e?: React.PointerEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
    }
    if (nudgeIntervalRef.current) {
      clearInterval(nudgeIntervalRef.current)
      nudgeIntervalRef.current = null
    }
    setActiveNudge(0)
    deck.nudge(0)
  }

  const pitchPercent = (deck.rate - 1) * 100

  // Incremental BPM tempo adjustment
  const stepPitchBpm = (deltaBpm: number) => {
    const ytDeck = youtubeBridge.state[deckId]
    const baseBpm = deck.track?.bpm || (ytDeck.hasVideo ? ytDeck.bpm : 120)
    const currentBpm = deck.effectiveBpm || (ytDeck.hasVideo ? ytDeck.bpm * ytDeck.playbackRate : baseBpm)
    const targetBpm = Math.max(20, Math.min(300, Math.round((currentBpm + deltaBpm) * 10) / 10))
    const newRate = targetBpm / baseBpm
    deck.setRate(newRate)
    youtubeBridge.setPlaybackRate(deckId, newRate)
  }

  // Key Sync logic
  const deckBaseCamelot = deck.track?.key?.camelot
  const otherBaseCamelot = otherDeck?.track?.key?.camelot
  const otherEffectiveCamelot = otherBaseCamelot
    ? shiftCamelot(otherBaseCamelot, otherDeck?.keyShift ?? 0)
    : null
  const currentEffectiveCamelot = deckBaseCamelot
    ? shiftCamelot(deckBaseCamelot, deck.keyShift)
    : null

  const optimalSyncShift =
    deckBaseCamelot && otherEffectiveCamelot
      ? findKeySyncShift(deckBaseCamelot, otherEffectiveCamelot)
      : 0
  const isKeySynced = Boolean(
    deckBaseCamelot &&
      otherEffectiveCamelot &&
      currentEffectiveCamelot &&
      (areKeysCompatible(currentEffectiveCamelot, otherEffectiveCamelot) ||
        (deck.keyShift !== 0 && deck.keyShift === optimalSyncShift))
  )

  const handleKeySync = () => {
    if (!deck.track || !otherDeck?.track || !deckBaseCamelot || !otherEffectiveCamelot) return
    deck.setKeyShift(optimalSyncShift)
    if (!deck.keyLock) deck.setKeyLock(true)
  }

  const isOuterLeft = side === 'left'

  return (
    <div
      className={`flex items-center ${
        kiosk ? 'gap-2' : 'gap-[24px]'
      } h-full select-none shrink-0 ${isOuterLeft ? 'flex-row' : 'flex-row-reverse'}`}
    >
      {/* ================= 1. OUTER EDGE: PITCH FADER SECTION ================= */}
      {/* 66 px on a desktop, 4 px of it side padding: the readout and the − / + strip are 58 px
          wide in that well. Kiosk keeps a sleeker 54 px to allow larger platters. */}
      <div
        className={`flex flex-col items-center justify-between h-full py-2 px-1 shrink-0 bg-[#161616] rounded-md border border-[#282828] select-none ${
          kiosk ? 'w-[54px]' : 'w-[66px]'
        }`}
      >
        {/* Pitch Rate Readout & Reset to 0%. */}
        <button
          type="button"
          onClick={() => {
            deck.setRate(1)
            youtubeBridge.setPlaybackRate(deckId, 1)
          }}
          className="w-full h-[22px] rounded-[3px] bg-[#101010] text-[9px] font-mono font-bold flex items-center justify-center tabular-nums tracking-tight text-[#dcdcdc] hover:text-white transition-all select-none"
          title="Click to reset pitch to 0.0%"
        >
          {pitchPercent >= 0 ? `+${pitchPercent.toFixed(1)}%` : `${pitchPercent.toFixed(1)}%`}
        </button>

        {/* Pitch Fader Slider */}
        <div className="flex-1 flex items-center justify-center my-1">
          <Fader
            orientation="vertical"
            min={1 - PITCH_RANGE / 100}
            max={1 + PITCH_RANGE / 100}
            step={0.0005}
            value={deck.rate}
            defaultValue={1}
            bipolar
            snapCenter
            invert
            ticks={9}
            onValueChange={r => {
              deck.setRate(r)
              youtubeBridge.setPlaybackRate(deckId, r)
            }}
            accentColor={accentColor}
            className={`w-6 ${kiosk ? 'h-[148px]' : 'h-[155px]'}`}
          />
        </div>

        {/* Pitch bend − / + */}
        <div className="flex items-center justify-between w-full px-0.5">
          <button
            type="button"
            onClick={() => stepPitchBpm(-0.1)}
            disabled={!deck.track}
            className="w-[22px] h-[22px] rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] flex items-center justify-center transition-all shadow-sm select-none disabled:opacity-20 shrink-0"
            title="Tempo down (-0.1 BPM)"
            aria-label="Tempo down"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              className="w-2.5 h-2.5"
              aria-hidden="true"
            >
              <path d="M3 8h10" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => stepPitchBpm(0.1)}
            disabled={!deck.track}
            className="w-[22px] h-[22px] rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] flex items-center justify-center transition-all shadow-sm select-none disabled:opacity-20 shrink-0"
            title="Tempo up (+0.1 BPM)"
            aria-label="Tempo up"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              className="w-2.5 h-2.5"
              aria-hidden="true"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>

      {/* ================= 2. CENTER: JOG WHEEL & NUDGE BUTTONS ================= */}
      <div className="relative flex items-center justify-center shrink-0">
        <JogWheel
          deck={deck}
          deckId={deckId}
          size={kiosk ? 236 : 184}
          accentColor={accentColor}
          className="border-[#282828] shadow-xl"
        />

        {/* Nudge Slow Down (−) */}
        <button
          type="button"
          onPointerDown={e => handleNudgeStart(-1, e)}
          onPointerUp={handleNudgeEnd}
          onPointerCancel={handleNudgeEnd}
          disabled={!deck.track}
          className={`absolute bottom-0 left-0 z-20 w-6 h-6 rounded-full border text-[13px] font-bold flex items-center justify-center transition-all select-none shadow-md ${
            activeNudge === -1
              ? ACTIVE
              : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-30'
          }`}
          title="Nudge − (Hold to temporarily slow down)"
        >
          −
        </button>

        {/* Nudge Speed Up (+) */}
        <button
          type="button"
          onPointerDown={e => handleNudgeStart(1, e)}
          onPointerUp={handleNudgeEnd}
          onPointerCancel={handleNudgeEnd}
          disabled={!deck.track}
          className={`absolute bottom-0 right-0 z-20 w-6 h-6 rounded-full border text-[13px] font-bold flex items-center justify-center transition-all select-none shadow-md ${
            activeNudge === 1
              ? ACTIVE
              : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-30'
          }`}
          title="Nudge + (Hold to temporarily speed up)"
        >
          +
        </button>
      </div>

      {/* ================= 3. INNER EDGE: KEY ADJUST & HOT CUES ================= */}
      {/* 64 px on desktop (52 px buttons in 54 px frames). Kiosk keeps 58 px. */}
      <div
        className={`flex flex-col items-center h-full py-2 px-1 ${
          kiosk ? 'w-[58px]' : 'w-[64px]'
        } shrink-0 bg-[#161616] rounded-md border border-[#282828] select-none`}
        title={`Deck ${deckId} Controls`}
      >
        {/* Top: Key Transpose Stepper [- 0 +] */}
        <div className="flex items-center justify-between w-full h-[22px] shrink-0" title="Key Transpose (-6 to +6 semitones)">
          <button
            type="button"
            onClick={() => deck.setKeyShift(Math.max(-6, deck.keyShift - 1))}
            disabled={!deck.track || deck.keyShift <= -6}
            className="w-[18px] h-[22px] rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] flex items-center justify-center transition-all shadow-sm select-none disabled:opacity-20 shrink-0"
            title="Transpose Key -1 semitone"
            aria-label="Transpose Key down"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              className="w-2.5 h-2.5"
              aria-hidden="true"
            >
              <path d="M3 8h10" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => deck.resetKeyShift()}
            disabled={!deck.track}
            className={`flex-1 h-[22px] mx-0.5 rounded-[3px] bg-[#101010] font-mono text-[9px] font-bold leading-none select-none transition-colors shadow-inner flex items-center justify-center shrink-0 ${
              deck.keyShift !== 0
                ? 'text-white'
                : 'text-[#dcdcdc] enabled:hover:text-white'
            }`}
            title="Click to reset Key shift to 0"
          >
            {deck.keyShift !== 0
              ? deck.keyShift > 0
                ? `+${deck.keyShift}`
                : `${deck.keyShift}`
              : '0'}
          </button>

          <button
            type="button"
            onClick={() => deck.setKeyShift(Math.min(6, deck.keyShift + 1))}
            disabled={!deck.track || deck.keyShift >= 6}
            className="w-[18px] h-[22px] rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] flex items-center justify-center transition-all shadow-sm select-none disabled:opacity-20 shrink-0"
            title="Transpose Key +1 semitone"
            aria-label="Transpose Key up"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              className="w-2.5 h-2.5"
              aria-hidden="true"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>

        {/* KEY SYNC Button */}
        <button
          type="button"
          onClick={handleKeySync}
          disabled={!deck.track || !otherDeck?.track}
          style={{ width: kiosk ? 48 : CONTROL_W }}
          className={`h-6 mt-1.5 rounded-[3px] border text-[8.5px] font-bold tracking-wider uppercase flex items-center justify-center transition-all select-none ${
            isKeySynced
              ? ACTIVE_KEY
              : 'bg-[#141414] text-[#777777] border-[#282828] enabled:hover:text-[#d4d4d4] enabled:hover:border-[#444444] disabled:cursor-not-allowed'
          }`}
          title={`KEY SYNC\nHarmonically matches this deck's key to ${otherDeck?.track ? `Deck ${deckId === 'A' ? 'B' : 'A'}` : 'other deck'}.`}
        >
          KEY
        </button>

        {/* Middle: SLIP Mode Toggle Button centered between KEY and CUES */}
        <div className="flex-1 flex items-center justify-center w-full my-1">
          <button
            type="button"
            onClick={() => deck.toggleFluxMode()}
            style={{ width: kiosk ? 48 : CONTROL_W }}
            className={`h-6 rounded-[3px] border text-[8.5px] font-bold tracking-wider uppercase flex items-center justify-center transition-all select-none ${
              deck.fluxMode
                ? ACTIVE_KEY
                : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title={`SLIP MODE (${deck.fluxMode ? 'ON' : 'OFF'})\nTimeline continues in background during cues, loops and FX, snapping back on release.`}
          >
            SLIP
          </button>
        </div>

        {/* Bottom: CUES label + 4 HOT CUE PADS bottom-aligned */}
        <div className="flex flex-col items-center w-full mt-auto shrink-0">
          <span className="text-[8.5px] font-semibold text-[#777777] uppercase tracking-wider mb-1.5 leading-none select-none">
            CUES
          </span>
          <div className="flex flex-col gap-1 w-full shrink-0 items-center">
            {[0, 1, 2, 3].map((i) => {
              const cueTime = deck.hotCues[i]
              const hasCue = cueTime !== null
              const isWaiting = deck.waitingCueIndex === i
              return (
                <div
                  key={i}
                  style={{ width: kiosk ? 48 : CONTROL_W, height: kiosk ? 20 : CONTROL_H }}
                  className="relative group/cue shrink-0"
                >
                  <button
                    type="button"
                    onPointerDown={e => {
                      if (e.button !== 0) return
                      if (e.shiftKey) {
                        deck.clearHotCue(i)
                        return
                      }
                      deck.hotCueDown(i)
                    }}
                    onPointerUp={e => {
                      if (e.button !== 0) return
                      deck.hotCueUp(i)
                    }}
                    onPointerLeave={() => {
                      deck.hotCueUp(i)
                    }}
                    onContextMenu={e => {
                      e.preventDefault()
                      if (hasCue) deck.clearHotCue(i)
                    }}
                    className={`w-full h-full rounded-[3px] border font-mono text-[10px] font-bold flex items-center justify-center transition-all select-none ${
                      isWaiting
                        ? 'border-white bg-[#141414] text-white animate-pulse'
                        : hasCue
                        ? ACTIVE
                        : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
                    }`}
                    title={
                      hasCue
                        ? `Hot Cue ${i + 1} (${cueTime?.toFixed(2)}s) — Right-click, Shift+Click, or click × to clear`
                        : `Set Hot Cue ${i + 1}`
                    }
                  >
                    {i + 1}
                  </button>
                  {hasCue && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        deck.clearHotCue(i)
                      }}
                      className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-600/90 text-white text-[8px] font-bold leading-none hidden group-hover/cue:flex items-center justify-center hover:bg-red-500 shadow-md z-30"
                      title={`Delete Hot Cue ${i + 1}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
