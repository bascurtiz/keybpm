import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { Fader } from './Fader'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'
import { useViewportMode } from '@/lib/use-viewport'
import { CONTROL_W, CONTROL_H, FADER_CAP_W, KIOSK_FADER_CAP_W } from '@/lib/dj/control-size'
import { ACTIVE_KEY, ACTIVE_LOOP_COUNT, ACTIVE_PLAY, ACTIVE_SWITCH, CELL } from '@/lib/dj/control-state'

interface TraktorTransportBarProps {
  engine: AudioEngine
  className?: string
}

/**
 * How many beats an auto-fade takes, cycled by the value chip next to the `<<` / `>>`
 * arrows. Both arrows share one value: the fade is a property of the move, not of the
 * destination, so a left fade and a right fade of the same length is what a DJ expects.
 * Deliberately independent of the 1/2/4/8/16/32 beat *loop* sizes — those are a loop
 * control, and having them silently set the crossfade length made the loop buttons a
 * hidden second job.
 */
const FADE_BEAT_STEPS = [4, 8, 16, 32, 64]

/**
 * How far the autopilot cuts the incoming deck's low while it fades in, in dB on the mixer's Low
 * knob. That knob sweeps 270°: −12 dB sits at 7:30, 0 at 12:00, so 9 o'clock — 90° of the 135°
 * negative half — is exactly −8 dB.
 *
 * This is the classic bass swap. Two kick drums at full low depth stack into a boom, so the
 * incoming one is cut before it is heard and the two hand over across the middle of the fade.
 */
const BASS_SWAP_CUT_DB = -8
/** Flat — the Low knob's 12 o'clock, where a band is neither cut nor boosted. */
const BASS_SWAP_FLAT_DB = 0

/**
 * When the low hand-over happens, as a fraction of the fade's travel: from the midpoint to three
 * quarters. Finishing early is the point — the incoming deck is already carrying full low while
 * the last quarter of the fader move is still running, rather than the bass arriving at the same
 * instant the fader parks, which leaves a mix of two half-lows for the whole second half.
 */
const BASS_SWAP_FROM = 0.5
const BASS_SWAP_TO = 0.75

/**
 * Solid triangle chevrons, sized 7 × 8 px, used for the loop/move and crossfader arrows.
 *
 * Drawn with borders rather than set as `‹` / `›` or `◀` / `▶`: the text glyph is whatever the
 * font supplies at whatever optical size it likes, which on Windows falls back to a different
 * shape from the one on macOS, and the triangle here is a control affordance that should be the
 * same everywhere. `border-*-current` makes it follow the button's text colour, so hover and press
 * light it without a second rule.
 */
/**
 * Width of the loop-length cluster (`◀ 8 ▶`), in design px.
 *
 * Deliberately wider than the console's standard 54 px control frame, unlike SYNC / TAP
 * and LOOP / MOVE on either side of it: at 54 the number sat in a 20 px slot between two
 * 16 px arrows, so the arrows were narrow for a thumb and the count looked squeezed. 84
 * is 1 px frame + 22 px arrow + 38 px number cell + 22 px arrow + 1 px frame — the
 * arrows get a thumb's width and the number gets a cell of its own.
 *
 * The transport row is `justify-between`, so the extra 30 px comes out of the space
 * between its three groups (each side group grows by 30, the centre stays put) rather
 * than out of the neighbouring switches.
 */
const LOOP_CLUSTER_W = 96

/** The two arrows flanking the loop count: `22 + 38 + 22 + 2` frame borders = `LOOP_CLUSTER_W`. */
const LOOP_CLUSTER_ARROW_W = 22

const TRIANGLE_LEFT =
  'block h-0 w-0 border-y-[4px] border-y-transparent border-r-[7px] border-r-current'
const TRIANGLE_RIGHT =
  'block h-0 w-0 border-y-[4px] border-y-transparent border-l-[7px] border-l-current'

export function TraktorTransportBar({ engine, className = '' }: TraktorTransportBarProps) {
  const { kiosk } = useViewportMode()
  const deckA = engine.decks.A
  const deckB = engine.decks.B

  /**
   * Height of AUTO and the auto-fade length chip, in design px.
   *
   * 24 on a phone: the height the transport's stacked LOOP / MOVE keys get from its 52 px key
   * row, so the centre cluster's two switches are the same size as the deck's. They were 22 —
   * `CONTROL_H` — which sat 2 px short of the LOOP / MOVE box next to them and read as a
   * different, smaller family of switch.
   */
  const centreKeyH = kiosk ? 24 : CONTROL_H

  const [, setVer] = useState(0)
  useEffect(() => {
    const unE = engine.subscribe(() => {
      setVer(v => v + 1)
      youtubeBridge.syncCrossfade(engine.crossfade, engine.masterVolume)
    })
    const unA = deckA.subscribe(() => setVer(v => v + 1))
    const unB = deckB.subscribe(() => setVer(v => v + 1))
    const unYt = youtubeBridge.subscribe(() => setVer(v => v + 1))
    return () => {
      unE()
      unA()
      unB()
      unYt()
    }
  }, [engine, deckA, deckB])

  // Default 4 beats matching the console layout and mockup
  // Opens on the longest fade in the cycle, 64 beats: an auto-crossfade is armed for the
  // long blend a set is built on, and the shorter lengths are one click away.
  const [fadeBeatsIdx, setFadeBeatsIdx] = useState(FADE_BEAT_STEPS.indexOf(64))
  const fadeBeats = FADE_BEAT_STEPS[fadeBeatsIdx]
  const cycleFadeBeats = () => setFadeBeatsIdx(i => (i + 1) % FADE_BEAT_STEPS.length)

  /**
   * AUTO arms the crossfader's own arrows: armed, they cross-fade; disarmed, they nudge 5 %.
   * One pair of controls instead of two, because the hand reaching for the fader is already
   * there. It is a latch, not a trigger — nothing moves until an arrow is pressed, so AUTO can
   * be armed at leisure and only lights to say the arrows mean something else now.
   */
  const [autoArmed, setAutoArmed] = useState(false)

  const toggleAuto = () => {
    // Disarming is "back to rest", which has to include stopping a fade still in flight — an
    // armed-then-disarmed bar must never leave the crossfader travelling on its own.
    if (autoArmed) abortAutoFade()
    setAutoArmed(v => !v)
  }

  // Auto-Fade animation state
  const autoFadeRafRef = useRef<number | null>(null)
  const [isFading, setIsFading] = useState<'left' | 'right' | null>(null)

  /** Stop a fade in flight, leaving the crossfader wherever it got to. */
  const abortAutoFade = () => {
    if (autoFadeRafRef.current !== null) {
      cancelAnimationFrame(autoFadeRafRef.current)
      autoFadeRafRef.current = null
    }
    setIsFading(null)
  }

  const triggerAutoFade = (targetDirection: 'left' | 'right') => {
    // Pressing the arrow that is already fading stops it. The crossfader holds its
    // current position rather than completing the move or snapping back, which is
    // where a manual nudge would have left it.
    if (isFading === targetDirection) {
      abortAutoFade()
      return
    }

    if (autoFadeRafRef.current !== null) {
      cancelAnimationFrame(autoFadeRafRef.current)
      autoFadeRafRef.current = null
    }

    const startVal = engine.crossfade
    const targetVal = targetDirection === 'left' ? -1 : 1
    if (Math.abs(startVal - targetVal) < 0.001) {
      setIsFading(null)
      return
    }

    // Duration in seconds: the shared fade length, at the tempo of the deck being
    // faded into when it is playing.
    const relevantDeck = targetDirection === 'left' ? deckA : deckB
    const otherDeck = targetDirection === 'left' ? deckB : deckA
    const activeDeck = relevantDeck.playing ? relevantDeck : otherDeck.playing ? otherDeck : relevantDeck
    const bpm = activeDeck.effectiveBpm || activeDeck.track?.bpm || engine.masterBpm || 128
    const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 128
    const beatSec = 60 / safeBpm
    const durationMs = Math.max(500, fadeBeats * beatSec * 1000)

    // The autopilot moves the low as well as the fader. `relevantDeck` is the deck being faded
    // *to* and `otherDeck` the one being faded out; their lows swap across the middle below.
    // The incoming low is cut straight away only if starting parked at the opposite rail,
    // where that deck is silent and the cut cannot be heard. If starting near center, avoid
    // an abrupt bass cut on an already audible deck.
    const outgoingLowStart = otherDeck.eqLowGain
    const incomingLowStart = relevantDeck.eqLowGain
    const isParkedAtOppositeRail =
      targetDirection === 'left' ? startVal >= 0.85 : startVal <= -0.85

    if (isParkedAtOppositeRail) {
      relevantDeck.setEqLow(BASS_SWAP_CUT_DB)
    }

    const startTime = performance.now()
    setIsFading(targetDirection)

    // Once the hand-over has landed there is nothing left to write: the last quarter of the fade
    // is the fader arriving. Stopping here also means a DJ who grabs the Low knob in that last
    // quarter is not fighting the autopilot for it every frame.
    let lowSwapComplete = false

    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / durationMs)
      // Smooth linear or slightly eased progress
      const currentVal = startVal + (targetVal - startVal) * progress
      engine.setCrossfade(currentVal)

      // Bass swap across the middle of the move. The first half needs no EQ work: the outgoing deck
      // is still carrying the mix, so pulling its low down early would gut it. From the midpoint the
      // two cross over — incoming rises to flat while the outgoing falls to the same cut, over one
      // window — so exactly one low is ever at full depth and the hand-over is symmetric. It starts
      // from wherever the outgoing low actually was, not from a forced flat.
      if (progress >= BASS_SWAP_FROM && !lowSwapComplete) {
        const swap = Math.min(1, (progress - BASS_SWAP_FROM) / (BASS_SWAP_TO - BASS_SWAP_FROM))
        const effectiveIncomingStart = isParkedAtOppositeRail ? BASS_SWAP_CUT_DB : incomingLowStart
        relevantDeck.setEqLow(effectiveIncomingStart + (BASS_SWAP_FLAT_DB - effectiveIncomingStart) * swap)
        otherDeck.setEqLow(outgoingLowStart + (BASS_SWAP_CUT_DB - outgoingLowStart) * swap)
        if (swap === 1) lowSwapComplete = true
      }

      if (progress < 1) {
        autoFadeRafRef.current = requestAnimationFrame(step)
      } else {
        engine.setCrossfade(targetVal)
        autoFadeRafRef.current = null
        setIsFading(null)
      }
    }

    autoFadeRafRef.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    return () => {
      if (autoFadeRafRef.current) cancelAnimationFrame(autoFadeRafRef.current)
    }
  }, [])

  const nudgeCrossfade = (delta: number) => {
    abortAutoFade()
    engine.setCrossfade(engine.crossfade + delta)
  }

  /** The crossfader's own `<` / `>` arrows: cross-fade while AUTO is armed, nudge 5 % while not. */
  const pressCrossfadeArrow = (direction: 'left' | 'right') => {
    if (autoArmed) {
      triggerAutoFade(direction)
      return
    }
    nudgeCrossfade(direction === 'left' ? -0.05 : 0.05)
  }

  return (
    <div
      className={`w-full bg-[#161616] border-t border-[#282828] ${
        // Symmetric air around the keys on a desktop, in design px: 16 under the divider and
        // 16 down to the chassis outline, so 77 = divider 1 + 16 + the row's 44 px keys + 16.
        // Explicit padding rather than a centred row with spare height, so the air is the
        // same on both sides instead of the row splitting whatever was left over — the
        // earlier 70 px bar put 9 px above the keys and 17 px below once the 8 px of bottom
        // padding was counted.
        // Kiosk gives 16 px of bottom air to match the top header's breathing room on mobile
        // (82 px = 1 px divider + 12 px top air + 52 px keys + 16 px bottom padding). The keys
        // are 52 — CONTROL_W — because a phone's transport is tapped blind, and at 46 px the
        // play button was the smallest thing a thumb had to find on the row.
        // 11 px of side padding on a phone, not the row's old 10: the deck row above pads itself
        // 11, so at 10 every transport group sat 1 px inside its deck and the LOOP / MOVE stack —
        // inset 6 px so it centres on the pads above it — landed 1 px off centre. Matching the
        // padding makes the bar's 1106 px content box exactly the deck row's.
        kiosk
          ? 'px-[11px] h-[82px] pt-3 pb-4 justify-between gap-1.5'
          : 'px-[14px] h-[77px] pt-4 pb-4 justify-center gap-[24px]'
      } flex items-center select-none ${className}`}
    >
      {/* ================= DECK A TRANSPORT (LEFT) ================= */}
      {/* 360 px on a phone — the width of the deck above it (64 pitch + 16 + 200 jog + 16 + 64
          keys), so each transport group covers exactly its own deck and the row is centred on the
          chassis: 360 + 402 + 360 plus the row's 22 px padding leaves 16 px of slack for
          `justify-between` to split, 8 either side of the crossfader. Matching the deck width is
          what lets PLAY sit under the deck's outer column on A and its inner one on B. */}
      <div className={`flex items-center shrink-0 ${kiosk ? 'w-[360px]' : 'w-[362px]'}`}>
        <DeckTransport deck={deckA} otherDeck={deckB} deckId="A" />
      </div>

      {/* ================= CENTER: AUTO | CROSSFADER | FADE LENGTH ================= */}
      {/* The crossfader's slot is 120 px on a phone, centred on the chassis like the mixer's
          filter/FX panel above it; a desktop asks for 136 and the frame squeezes it to what the
          arrows and padding leave. The slot is the fader's travel: the panel is a section, the
          crossfader is a control, and at the panel's full 148 (then 132) the cap's run read as the
          widest thing between the decks. The cluster around it — AUTO, the two arrows, the beat
          count — travels with it. */}
      <div className={`flex items-center justify-center shrink-0 ${kiosk ? 'w-[402px] gap-1.5' : 'w-[384px] gap-1.5'}`}>
        <button
          type="button"
          onClick={toggleAuto}
          aria-pressed={autoArmed}
          style={{ width: CONTROL_W, height: centreKeyH }}
          className={`rounded-[3px] border text-[8.5px] font-bold uppercase tracking-wider flex items-center justify-center transition-all select-none ${
            autoArmed
              ? ACTIVE_KEY
              : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
          }`}
          title={
            autoArmed
              ? `AUTO armed — the crossfader's < / > cross-fade over ${fadeBeats} beats. Click to disarm.`
              : `Arm AUTO: the crossfader's < / > then cross-fade over ${fadeBeats} beats with a bass swap`
          }
        >
          AUTO
        </button>

        {/* The crossfader's own framed section. Its width is the one that reads: the slot inside
            can shrink all it likes, but the border is what the eye measures the control by. On a
            phone it is 200 px — the 120 px slot, the two 24 px arrows, 8 px either side and 8 px
            between them — with both arrows keeping a full cell. The middle cluster is 402 wide
            and its AUTO / count keys are 52 each, so those 100 px of travel are free: the section
            grows into slack the cluster already had, not into the decks. */}
        <div className={`w-[200px] ${kiosk ? 'h-[52px]' : 'h-11'} flex items-center justify-between gap-1 px-2 bg-[#141414] rounded-[3px] border border-[#282828]`}>
          <button
            type="button"
            onClick={() => pressCrossfadeArrow('left')}
            className={`flex items-center justify-center w-6 h-7 rounded transition-all select-none ${CELL} ${
              isFading === 'left'
                ? `${ACTIVE_KEY} animate-pulse`
                : 'bg-[#141414] text-[#777777] hover:text-[#d4d4d4] active:text-white'
            }`}
            title={
              isFading === 'left'
                ? 'Stop auto-fade'
                : autoArmed
                  ? `Cross-fade to Deck A over ${fadeBeats} beats`
                  : 'Nudge Crossfader toward Deck A'
            }
          >
            <span className={TRIANGLE_LEFT} aria-hidden="true" />
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
            onValueChange={v => {
              abortAutoFade()
              engine.setCrossfade(v)
            }}
            label="Crossfader"
            capWidth={kiosk ? KIOSK_FADER_CAP_W : FADER_CAP_W}
            className={kiosk ? 'h-8 w-[120px] max-w-[120px]' : 'h-6 w-[136px] max-w-[136px]'}
          />

          <button
            type="button"
            onClick={() => pressCrossfadeArrow('right')}
            className={`flex items-center justify-center w-6 h-7 rounded transition-all select-none ${CELL} ${
              isFading === 'right'
                ? `${ACTIVE_KEY} animate-pulse`
                : 'bg-[#141414] text-[#777777] hover:text-[#d4d4d4] active:text-white'
            }`}
            title={
              isFading === 'right'
                ? 'Stop auto-fade'
                : autoArmed
                  ? `Cross-fade to Deck B over ${fadeBeats} beats`
                  : 'Nudge Crossfader toward Deck B'
            }
          >
            <span className={TRIANGLE_RIGHT} aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={cycleFadeBeats}
          aria-label={`Auto-fade length: ${fadeBeats} beats`}
          style={{ width: CONTROL_W, height: centreKeyH }}
          className="rounded-[5px] border border-[#282828] bg-[#101010] text-[#dcdcdc] hover:text-white hover:border-[#444444] font-mono text-[10.5px] font-bold leading-none flex items-center justify-center transition-all select-none"
          title={`Auto-fade length: ${fadeBeats} beats — click to cycle 4 / 8 / 16 / 32 / 64`}
        >
          {fadeBeats}
        </button>
      </div>

      {/* ================= DECK B TRANSPORT (RIGHT) ================= */}
      <div className={`flex items-center shrink-0 ${kiosk ? 'w-[360px]' : 'w-[362px]'}`}>
        <DeckTransport deck={deckB} otherDeck={deckA} deckId="B" />
      </div>
    </div>
  )
}

const LOOP_BEAT_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64]

function formatLoopBeats(beats: number): string {
  if (beats === 0.25) return '1/4'
  if (beats === 0.5) return '1/2'
  if (beats === 0.125) return '1/8'
  return String(beats)
}

/**
 * Press feedback for the loop cluster's triangles, the same idea as the − / + under the pitch
 * fader: while the button is held the cell fills and the glyph goes white.
 *
 * The fill *is* the feedback here, where the pitch pair gets an outline. The triangles sit in a
 * group whose outer border and two hairline dividers are the only lines in the control, and each
 * cell owns none of them — so an outline would have had to be drawn inside the cell, which at
 * this size reads as a second box rather than as the button's own edge.
 *
 * `active:transition-none` is load-bearing, not tidiness. The cell's `transition-colors` covers
 * background-color and color, so without this the fill would *fade in* over the 150 ms default —
 * longer than a click, which means a quick tap would never reach full brightness and a held press
 * would look mushy. Killing the transition for the duration of the press makes the white appear in
 * the same frame the button goes down, while the release still fades out.
 */

function DeckTransport({
  deck,
  otherDeck,
  deckId,
}: {
  deck: DeckEngine
  otherDeck: DeckEngine
  deckId: 'A' | 'B'
}) {
  // Opens on 16 beats: a bar-and-a-half phrase is the default loop in a DJ set far more
  // often than the four-beat bar, and the cluster steps down to it in two clicks.
  const [selectedLoopIdx, setSelectedLoopIdx] = useState(LOOP_BEAT_SIZES.indexOf(16))
  // What the < number > cluster under the switch does: size and toggle a loop, or beat-jump the
  // playhead. Kept per deck, like the size, so the two transports can be set up differently.
  // MOVE is a toggle of its own rather than a mode: on makes the arrows jump the playhead, off
  // makes them resize the loop.
  const [moveOn, setMoveOn] = useState(false)
  const currentBeats = LOOP_BEAT_SIZES[selectedLoopIdx]
  const isPlaying = deck.playing
  const isLoopActive = Boolean(deck.loop)
  const { kiosk } = useViewportMode()
  /** Height of the transport's key row: 44 px on a desktop, a thumb's 52 px on a phone. */
  const keyH = kiosk ? 'h-[52px]' : 'h-11'

  // 4-Tap Tempo System
  const tapTimesRef = useRef<number[]>([])
  const [tapCount, setTapCount] = useState(0)
  const tapResetTimerRef = useRef<number | null>(null)

  const handleTapTempo = () => {
    if (!deck.track) return
    const now = performance.now()
    const taps = tapTimesRef.current

    // Reset if previous tap was more than 2.5 seconds ago
    if (taps.length > 0 && now - taps[taps.length - 1] > 2500) {
      taps.length = 0
    }

    taps.push(now)
    if (taps.length > 8) taps.shift()
    const count = taps.length
    setTapCount(count)

    if (tapResetTimerRef.current) window.clearTimeout(tapResetTimerRef.current)
    tapResetTimerRef.current = window.setTimeout(() => {
      taps.length = 0
      setTapCount(0)
    }, 2500)

    // Calculate BPM over intervals as user taps
    if (taps.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1])
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      if (avgInterval > 0) {
        const calculatedBpm = Math.max(30, Math.min(300, Math.round((60000 / avgInterval) * 10) / 10))
        deck.setTrackBpm(calculatedBpm)
      }
    }

    // After 4 full taps, complete sequence
    if (taps.length >= 4) {
      if (tapResetTimerRef.current) window.clearTimeout(tapResetTimerRef.current)
      tapResetTimerRef.current = window.setTimeout(() => {
        taps.length = 0
        setTapCount(0)
      }, 700)
    }
  }

  const toggleLoop = () => {
    if (!deck.track) return
    if (deck.loop) {
      deck.exitLoop()
    } else {
      // Local beat length at the loop start, so loops stay beat-accurate on a
      // variable-tempo grid instead of assuming one global tempo.
      let start = deck.position
      const beatLen = deck.beatLengthAt(start)
      if (deck.snapMode && beatLen > 0) {
        if (currentBeats < 1) {
          // Snap to the nearest fractional sub-beat subdivision (e.g. 1/2 or 1/4 beat)
          const beatGridStart = deck.snapToBeat(start)
          const offsetBeats = (start - beatGridStart) / beatLen
          const snappedFractionalBeats = Math.round(offsetBeats / currentBeats) * currentBeats
          start = beatGridStart + snappedFractionalBeats * beatLen
        } else {
          start = deck.snapToBeat(start)
        }
      }
      const loopLenSeconds = currentBeats * deck.beatLengthAt(start)
      deck.setLoop(start, start + loopLenSeconds)
    }
  }

  /**
   * MOVE on/off. Switching it off also releases any loop, so leaving jump mode hands the cluster
   * back with nothing running. Now that MOVE jumps the playhead instead of travelling the loop,
   * that coupling is no longer load-bearing — it is kept because it was asked for explicitly, and
   * dropping it is a one-line change.
   */
  const toggleMove = () => {
    setMoveOn(v => !v)
  }

  const loopHalf = () => {
    const nextIdx = Math.max(0, selectedLoopIdx - 1)
    setSelectedLoopIdx(nextIdx)
    if (deck.loop && deck.track) {
      const beatLen = deck.beatLengthAt(deck.loop.start)
      const halfBeats = LOOP_BEAT_SIZES[nextIdx]
      const halfLen = halfBeats * beatLen
      deck.setLoop(deck.loop.start, deck.loop.start + halfLen)
    }
  }

  const loopDouble = () => {
    const nextIdx = Math.min(LOOP_BEAT_SIZES.length - 1, selectedLoopIdx + 1)
    setSelectedLoopIdx(nextIdx)
    if (deck.loop && deck.track) {
      const beatLen = deck.beatLengthAt(deck.loop.start)
      const doubleBeats = LOOP_BEAT_SIZES[nextIdx]
      const doubleLen = doubleBeats * beatLen
      deck.setLoop(deck.loop.start, deck.loop.start + doubleLen)
    }
  }

  /**
   * MOVE: jump the playhead by the selected beat value.
   *
   * Not a loop action — pressing MOVE and then an arrow no longer arms a loop the user had not
   * asked for. A loop that is *already* running keeps running and travels with the jump (see
   * `DeckEngine.movePlayhead`): the window keeps its length and the playhead keeps its place
   * inside it, so a four-beat loop stays the four beats you were hearing, one step along. With
   * no loop armed this is a plain beat jump, clamped rather than refused at the ends so the
   * arrows stay usable.
   */
  const beatJump = (direction: -1 | 1) => {
    if (!deck.track) return
    deck.movePlayhead(direction * currentBeats * deck.beatLengthAt(deck.position))
  }

  /**
   * MOVE's value control cycles the jump step instead of toggling the loop — same button, a
   * different job depending on which switch is lit.
   */
  const cycleBeats = () => setSelectedLoopIdx(i => (i + 1) % LOOP_BEAT_SIZES.length)

  const ytState = youtubeBridge.state[deckId]
  const hasYt = ytState.hasVideo && !deck.track
  const isPlayingActive = isPlaying || (hasYt && ytState.playing)
  const isDeckReady = Boolean(deck.track || hasYt)

  const handleTogglePlay = () => {
    // Prefer local Web Audio when present; never drive both sources at once.
    if (deck.track) {
      void deck.togglePlay()
      return
    }
    if (hasYt) {
      youtubeBridge.togglePlay(deckId)
    }
  }

  const handleCueDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    if (deck.track) {
      void deck.cueDown()
      return
    }
    if (hasYt) {
      youtubeBridge.seekTo(deckId, ytState.cuePoint)
      youtubeBridge.play(deckId)
    }
  }

  const handleCueUp = (e?: React.PointerEvent) => {
    if (e) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      } catch {
        // ignore
      }
    }
    if (deck.track) {
      deck.cueUp()
      return
    }
    if (hasYt) {
      youtubeBridge.seekTo(deckId, ytState.cuePoint)
      youtubeBridge.pause(deckId)
    }
  }

  const handleCueKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (!e.repeat) {
        if (deck.track) {
          void deck.cueDown()
          return
        }
        if (hasYt) {
          youtubeBridge.seekTo(deckId, ytState.cuePoint)
          youtubeBridge.play(deckId)
        }
      }
    }
  }

  const handleCueKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (deck.track) {
        deck.cueUp()
        return
      }
      if (hasYt) {
        youtubeBridge.seekTo(deckId, ytState.cuePoint)
        youtubeBridge.pause(deckId)
      }
    }
  }

  return (
    <div
      className={`flex items-center ${
        kiosk ? 'w-[360px] pl-[4px] gap-1.5' : `w-[362px] ${deckId === 'A' ? 'pr-[5px]' : 'pr-[6px]'}`
      }`}
    >
      {/* Left Cluster: Play/Cue + Sync/Tap. Kiosk leaves 16 px between CUE and the SYNC stack:
          CUE is half-width now, and at 6 px the slim key read as part of the play/CUE pair rather
          than as the switch before SYNC. Desktop keeps its 14. */}
      <div className={`flex items-center shrink-0 ${kiosk ? 'gap-[16px]' : 'gap-[14px]'}`}>
        {/* Play & CUE standalone rounded buttons. Kiosk runs them side by side at the key row's
            height: play grows to 56 px, and CUE becomes a half-width full-height key — 26 px of
            edge to hit, the same height as play — with its label turned 90°. The two keys a thumb
            hits while cueing stay tall enough to find without looking, while CUE gives back the
            width a half-size key should not be holding. */}
        <div className={`flex shrink-0 items-stretch gap-1 ${keyH} ${kiosk ? 'w-[86px]' : 'w-[100px]'}`}>
          <button
            type="button"
            onClick={handleTogglePlay}
            disabled={!isDeckReady}
            className={`${kiosk ? 'w-[56px]' : 'w-12'} h-full rounded-[3px] border flex items-center justify-center transition-all select-none ${
              isPlayingActive
                ? ACTIVE_PLAY
                : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title={`Deck ${deckId} Play / Pause (Space / Click)`}
          >
            <span className={`${kiosk ? 'text-lg' : 'text-base'} font-bold leading-none`}>▶</span>
          </button>

          <button
            type="button"
            onPointerDown={handleCueDown}
            onPointerUp={handleCueUp}
            onPointerCancel={handleCueUp}
            onKeyDown={handleCueKeyDown}
            onKeyUp={handleCueKeyUp}
            onClick={e => e.preventDefault()}
            onContextMenu={e => e.preventDefault()}
            disabled={!isDeckReady}
            className={`${
              kiosk ? 'w-[26px] shrink-0 [writing-mode:vertical-rl] rotate-180' : 'flex-1'
            } h-full rounded-[3px] border flex items-center justify-center text-[10px] font-bold uppercase tracking-wider transition-all select-none ${
              deck.cuePreviewing
                ? ACTIVE_KEY
                : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title={`Deck ${deckId} Cue (Hold to preview, release to snap back)`}
          >
            CUE
          </button>
        </div>

        {/* SYNC / TAP dual stacked standalone buttons */}
        <div
          style={{ width: CONTROL_W }}
          className={`flex flex-col shrink-0 gap-1 ${keyH}`}
        >
          <button
            type="button"
            onClick={() => deck.syncTo(otherDeck)}
            disabled={!deck.track || !otherDeck?.track}
            className={`w-full flex-1 rounded-[3px] border text-[8.5px] font-bold uppercase tracking-wider leading-none transition-all flex items-center justify-center select-none ${
              deck.syncLocked
                ? ACTIVE_KEY
                : 'bg-[#141414] text-[#777777] border-[#282828] enabled:hover:text-[#d4d4d4] enabled:hover:border-[#444444] disabled:cursor-not-allowed'
            }`}
            title={`Deck ${deckId} Sync — lock tempo and phase to other deck`}
          >
            SYNC
          </button>
          <button
            type="button"
            onClick={handleTapTempo}
            disabled={!deck.track}
            className={`w-full flex-1 rounded-[3px] border text-[8.5px] font-bold uppercase tracking-wider leading-none transition-all flex items-center justify-center select-none ${
              tapCount > 0
                ? ACTIVE_KEY
                : 'bg-[#141414] text-[#777777] border-[#282828] enabled:hover:text-[#d4d4d4] enabled:hover:border-[#444444] disabled:cursor-not-allowed'
            }`}
            title={`Deck ${deckId} Tap Tempo — Tap 4 times in rhythm to set BPM`}
          >
            {tapCount > 0 ? (
              <span className="font-mono text-[8px] font-bold">
                {((tapCount - 1) % 4) + 1}/4
              </span>
            ) : (
              'TAP'
            )}
          </button>
        </div>
      </div>

      {/* Slack between Sync/Tap and Loop cluster. Kiosk gets it too: CUE is now half-width and the
          deck's keys are left-packed, so without this the loop cluster floated mid-deck and its
          right edge no longer sat under the deck's own. */}
      <div className="flex-1" aria-hidden="true" />

      {/* Right Cluster: Loop cluster + Loop/Move */}
      {/* 6 px of right inset on a phone, so the LOOP / MOVE stack's centre lines up with the hot cue
          pads above it: those sit in the deck's 64 px key column, 6 px in from the column's edge
          (2 px padding plus the 1 px border, either side of a 52 px face). Without it the stack sat
          flush at the deck's edge and read 14 px off the pads it belongs to. */}
      <div
        className={`flex items-center shrink-0 ${
          kiosk ? 'gap-1.5 pr-[6px]' : 'gap-[14px]'
        }`}
      >
        {/* Loop Beat Length Cluster: < 4 > standalone elements matching - and + buttons */}
        <div
          style={{ width: kiosk ? 104 : LOOP_CLUSTER_W }}
          className={`flex shrink-0 items-stretch gap-1 ${keyH}`}
        >
          <button
            type="button"
            onClick={moveOn ? () => beatJump(-1) : loopHalf}
            disabled={moveOn ? !deck.track : !deck.track || selectedLoopIdx === 0}
            style={{ width: LOOP_CLUSTER_ARROW_W }}
            className="shrink-0 flex items-center justify-center rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] transition-all select-none disabled:opacity-20"
            aria-label={
              moveOn
                ? `Jump the playhead back ${formatLoopBeats(currentBeats)} beats`
                : 'Half loop length'
            }
            title={
              moveOn
                ? `Jump the playhead back ${formatLoopBeats(currentBeats)} beats (a running loop comes with it)`
                : 'Half loop length (÷2)'
            }
          >
            <span className={TRIANGLE_LEFT} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={moveOn ? cycleBeats : toggleLoop}
            disabled={!deck.track}
            className={`flex-1 rounded-[3px] border flex items-center justify-center transition-all text-[11px] font-mono font-bold leading-none select-none ${
              isLoopActive
                ? ACTIVE_LOOP_COUNT
                : 'bg-[#101010] text-[#dcdcdc] border-[#282828] hover:text-white hover:border-[#444444]'
            }`}
            aria-label={
              moveOn ? `${formatLoopBeats(currentBeats)}-beat jump step` : `Loop ${formatLoopBeats(currentBeats)} beats`
            }
            title={
              moveOn
                ? `${formatLoopBeats(currentBeats)}-beat jump step — click to cycle the size`
                : `Loop ${formatLoopBeats(currentBeats)} beats (Click to toggle)`
            }
          >
            {formatLoopBeats(currentBeats)}
          </button>

          <button
            type="button"
            onClick={moveOn ? () => beatJump(1) : loopDouble}
            disabled={
              moveOn ? !deck.track : !deck.track || selectedLoopIdx === LOOP_BEAT_SIZES.length - 1
            }
            style={{ width: LOOP_CLUSTER_ARROW_W }}
            className="shrink-0 flex items-center justify-center rounded-[3px] bg-[#141414] border border-[#282828] hover:border-[#444444] text-[#777777] hover:text-[#d4d4d4] active:text-white active:border-white active:bg-[#101010] active:shadow-[0_0_8px_rgba(255,255,255,0.25)] transition-all select-none disabled:opacity-20"
            aria-label={
              moveOn
                ? `Jump the playhead forward ${formatLoopBeats(currentBeats)} beats`
                : 'Double loop length'
            }
            title={
              moveOn
                ? `Jump the playhead forward ${formatLoopBeats(currentBeats)} beats (a running loop comes with it)`
                : 'Double loop length (×2)'
            }
          >
            <span className={TRIANGLE_RIGHT} aria-hidden="true" />
          </button>
        </div>

        {/* Loop / Move standalone stacked buttons */}
        <div
          style={{ width: CONTROL_W }}
          className={`flex flex-col shrink-0 gap-1 ${keyH}`}
        >
          <button
            type="button"
            onClick={toggleLoop}
            aria-pressed={isLoopActive}
            className={`w-full flex-1 rounded-[3px] border text-[8.5px] font-bold uppercase tracking-wider leading-none transition-all flex items-center justify-center select-none ${
              isLoopActive
                ? ACTIVE_SWITCH
                : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title={
              isLoopActive
                ? `LOOP running (${formatLoopBeats(currentBeats)} beats) — click to release it`
                : `LOOP: arm a ${formatLoopBeats(currentBeats)}-beat loop at the playhead`
            }
          >
            LOOP
          </button>
          <button
            type="button"
            onClick={toggleMove}
            aria-pressed={moveOn}
            className={`w-full flex-1 rounded-[3px] border text-[8.5px] font-bold uppercase tracking-wider leading-none transition-all flex items-center justify-center select-none ${
              moveOn
                ? ACTIVE_KEY
                : 'bg-[#141414] text-[#777777] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title={
              moveOn
                ? 'MOVE on — the arrows beat-jump the playhead (a running loop travels with it), the number cycles the step'
                : 'MOVE: the arrows beat-jump the playhead by the step'
            }
          >
            MOVE
          </button>
        </div>
      </div>
    </div>
  )
}
