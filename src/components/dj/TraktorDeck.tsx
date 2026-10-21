import { useEffect, useRef, useState } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { JogWheel } from './JogWheel'
import { Fader } from './Fader'
import { shiftCamelot, findKeySyncShift, areKeysCompatible } from '@/lib/camelot'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'
import { useViewportMode } from '@/lib/use-viewport'
import { CONTROL_W, CONTROL_H } from '@/lib/dj/control-size'
import { ACTIVE, ACTIVE_KEY, ACTIVE_SWITCH, CELL } from '@/lib/dj/control-state'

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
        kiosk ? 'gap-2.5' : 'gap-[14px]'
      } h-full select-none shrink-0 ${isOuterLeft ? 'flex-row' : 'flex-row-reverse'}`}
    >
      {/* ================= 1. OUTER EDGE: PITCH FADER SECTION ================= */}
      {/* 62 px with 4 px of side padding: the readout and the − / + strip are 52 px wide in a
          52 px well, so the column is as tight as it can be around them. Widened once for air
          and put back — the pitch fader reads as a column of gauges, and a column of gauges
          wants its scale at the edge, unlike the filter/FX block, which needed the room. */}
      <div
        className="flex flex-col items-center justify-between h-full py-2 px-1 w-[62px] shrink-0 bg-[#161616] rounded-md border border-[#282828] select-none"
      >
        {/* Pitch Rate Readout & Reset to 0%. A readout, not a key: the value sits on the
            console's darkest surface without a frame, so it reads as a printed number until
            you click it. The centred state says so in white type, not with a border. */}
        <button
          type="button"
          onClick={() => {
            deck.setRate(1)
            youtubeBridge.setPlaybackRate(deckId, 1)
          }}
          className="w-full h-5 rounded-[5px] bg-[#101010] text-[9px] font-mono font-bold flex items-center justify-center tabular-nums tracking-tight text-[#dcdcdc] hover:text-white transition-all select-none"
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
            className="w-6 h-[140px]"
          />
        </div>

        {/* Pitch bend − / +. The strip itself is flat on the console's darkest surface, but
            the two keys keep their frames: they are buttons, and at 9 px the border is the only
            thing saying so next to the bare readout above. The range key that used to sit under
            this pair is gone — the fader is fixed at ±10 % (see PITCH_RANGE), so there is no
            setting left to show. */}
        <div className="flex flex-col w-full rounded-[5px] bg-[#101010] overflow-hidden">
          <div className="flex items-stretch w-full h-5 rounded-[4px] border border-[#282828] overflow-hidden">
            <button
              type="button"
              onClick={() => stepPitchBpm(-0.1)}
              className="flex-1 border-r border-[#282828] bg-[#141414] text-[11px] font-bold text-[#dcdcdc] hover:text-white hover:border-r-[#444444] flex items-center justify-center active:text-white transition-all select-none"
              title="Tempo down (-0.1 BPM)"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => stepPitchBpm(0.1)}
              className="flex-1 bg-[#141414] text-[11px] font-bold text-[#dcdcdc] hover:text-white flex items-center justify-center active:text-white transition-all select-none"
              title="Tempo up (+0.1 BPM)"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* ================= 2. CENTER: JOG WHEEL & NUDGE BUTTONS ================= */}
      {/* The nudge pair sits in the jog block's corners, not 4 px inside them. The block is
          exactly the jog's 168 px, so at `left-1` the 24 px buttons were pinned against the
          platter's outer ring — a circle inscribed in a square leaves its corners empty, and
          the outer inch of that diagonal is where they belong. Cornering them moves each one
          4 px out and 4 px down, which is 5.7 px of clearance from the ring where there was
          a hairline. */}
      <div className="relative flex items-center justify-center shrink-0">
        <JogWheel
          deck={deck}
          deckId={deckId}
          size={168}
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
      {/* 64 px, not 62: its 52 px buttons sit in 54 px frames (see control-size.ts), and
          the extra 2 px of column is what lets a 54 px frame hold a 52 px face without
          pressing against the column's own border. That is the width SLIP, SYNC, TAP,
          LOOP and MOVE now all measure. */}
      <div
        className="flex flex-col items-center h-full py-2 px-1 w-[64px] shrink-0 bg-[#161616] rounded-md border border-[#282828] select-none"
        title={`Deck ${deckId} Controls`}
      >
        {/* Top: Key Transpose Stepper [- 0 +] and KEY Button unified container */}
        <div className="flex flex-col w-full rounded-[3px] border border-[#282828] bg-[#141414] overflow-hidden shrink-0">
          {/* Key Transpose Stepper: [- 0 +] */}
          <div className="flex items-center w-full h-[22px] border-b border-[#282828]" title="Key Transpose (-6 to +6 semitones)">
            <button
              type="button"
              onClick={() => deck.setKeyShift(Math.max(-6, deck.keyShift - 1))}
              disabled={!deck.track || deck.keyShift <= -6}
              className="flex-1 h-full text-[12px] font-bold text-[#777777] hover:text-[#d4d4d4] active:text-white disabled:opacity-25 transition-all flex items-center justify-center select-none"
              title="Transpose Key -1 semitone"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => deck.resetKeyShift()}
              disabled={!deck.track}
              className={`w-[18px] h-full bg-[#101010] border-x border-[#282828] font-mono text-[9px] font-bold leading-none select-none transition-colors shadow-inner flex items-center justify-center shrink-0 ${
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
              className="flex-1 h-full text-[12px] font-bold text-[#777777] hover:text-[#d4d4d4] active:text-white disabled:opacity-25 transition-all flex items-center justify-center select-none"
              title="Transpose Key +1 semitone"
            >
              +
            </button>
          </div>

          {/* KEY SYNC Button */}
          <button
            type="button"
            onClick={handleKeySync}
            disabled={!deck.track || !otherDeck?.track}
            className={`h-[22px] w-full ${CELL} text-[8.5px] font-bold tracking-wider uppercase flex items-center justify-center transition-all select-none ${
              isKeySynced
                ? ACTIVE_KEY
                : 'bg-[#141414] text-[#777777] enabled:hover:text-[#d4d4d4] disabled:cursor-not-allowed'
            }`}
            title={`KEY SYNC\nHarmonically matches this deck's key to ${otherDeck?.track ? `Deck ${deckId === 'A' ? 'B' : 'A'}` : 'other deck'}.`}
          >
            KEY
          </button>
        </div>

        {/* Middle: SLIP Mode Toggle Button centered between KEY and CUES */}
        <div className="flex-1 flex items-center justify-center w-full my-1">
          <button
            type="button"
            onClick={() => deck.toggleFluxMode()}
            style={{ width: CONTROL_W }}
            className={`h-[22px] rounded-[3px] border text-[8.5px] font-bold tracking-wider uppercase flex items-center justify-center transition-all select-none ${
              deck.fluxMode
                ? ACTIVE_SWITCH
                : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title={`SLIP MODE (${deck.fluxMode ? 'ON' : 'OFF'})\nTimeline continues in background during cues, loops and FX, snapping back on release.`}
          >
            SLIP
          </button>
        </div>

        {/* Bottom: CUES label + 4 HOT CUE PADS bottom-aligned */}
        <div className="flex flex-col items-center w-full mt-auto shrink-0">
          {/* 8 px under the caption, not 4: at `mb-1` the word sat closer to the pad frame
              than the pads sit to the column's own border, so it read as part of the frame
              rather than a heading over it. The block is `mt-auto` and the SLIP row above
              is `flex-1`, so the extra 4 px comes out of the SLIP band and the pads stay
              where they are. */}
          <span className="text-[8.5px] font-semibold text-[#888888] uppercase tracking-wider mb-2 leading-none select-none">
            CUES
          </span>
          {/* No `overflow-hidden` here: the clear-cue badge hangs off the top-right corner of
              its pad, and a clipping frame cut it down to the sliver that made it read as
              part of the pad's border. The corner cells round themselves instead (below),
              which is what the clip was standing in for. */}
          <div className="flex flex-col w-full shrink-0 rounded-[3px] border border-[#282828] bg-[#141414]">
            {[0, 1, 2, 3].map((i, idx) => {
              const cueTime = deck.hotCues[i]
              const hasCue = cueTime !== null
              const isWaiting = deck.waitingCueIndex === i
              return (
                <div
                  key={i}
                  style={{ height: CONTROL_H }}
                  className={`relative group/cue w-full shrink-0 ${idx < 3 ? 'border-b border-[#282828]' : ''}`}
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
                    className={`w-full h-full border font-mono text-[10px] font-bold flex items-center justify-center transition-all select-none ${
                      idx === 0 ? 'rounded-t-[2px]' : idx === 3 ? 'rounded-b-[2px]' : ''
                    } ${
                      isWaiting
                        ? 'border-transparent bg-[#141414] text-white animate-pulse'
                        : hasCue
                        ? ACTIVE
                        : 'border-transparent bg-[#141414] text-[#777777] hover:text-[#d4d4d4]'
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
