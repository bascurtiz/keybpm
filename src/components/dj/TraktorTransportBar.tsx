import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { Fader } from './Fader'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

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

export function TraktorTransportBar({ engine, className = '' }: TraktorTransportBarProps) {
  const deckA = engine.decks.A
  const deckB = engine.decks.B

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

  // Default 32 beats — eight bars, i.e. two phrases. Opening on the shortest step (4) made the
  // chip a warning light rather than a setting: almost every real fade got cycled up first.
  const [fadeBeatsIdx, setFadeBeatsIdx] = useState(3)
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
    const beatSec = 60 / bpm
    const durationMs = Math.max(500, fadeBeats * beatSec * 1000)

    // The autopilot moves the low as well as the fader. `relevantDeck` is the deck being faded
    // *to* and `otherDeck` the one being faded out; their lows swap across the middle below.
    // The incoming low is cut straight away rather than ramped: every fade worth automating
    // starts from one end of the fader, where that deck is silent and the cut cannot be heard.
    const outgoingLowStart = otherDeck.eqLowGain
    relevantDeck.setEqLow(BASS_SWAP_CUT_DB)

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
        relevantDeck.setEqLow(BASS_SWAP_CUT_DB + (BASS_SWAP_FLAT_DB - BASS_SWAP_CUT_DB) * swap)
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
      className={`w-full bg-[#161616] border-t border-[#282828] px-3 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-4 select-none ${className}`}
    >
      {/* ================= DECK A TRANSPORT (LEFT) ================= */}
      <div className="flex items-center justify-start">
        <DeckTransport deck={deckA} deckId="A" />
      </div>

      {/* ================= CENTER: AUTO ARMS THE CROSSFADER, FADE LENGTH BESIDE IT ================= */}
      <div className="w-[380px] flex items-center justify-center">
        {/* The crossfader is the only in-flow child, so it stays on the bar's centre line whatever
            the width of the two controls flanking it. They are absolute for exactly that reason:
            AUTO is wider than the length chip, and in flow they would push the fader off-centre —
            the thing the previous layout was rearranged to stop. */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={toggleAuto}
            aria-pressed={autoArmed}
            className={`absolute right-full mr-2 top-1/2 -translate-y-1/2 h-[18px] px-1.5 rounded-[3px] border text-[7.5px] font-bold uppercase tracking-wider flex items-center justify-center transition-all ${
              autoArmed
                ? 'bg-[#141414] text-white border-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                : 'bg-[#141414] text-[#666666] border-[#282828] hover:text-[#d4d4d4] hover:border-[#444444]'
            }`}
            title={
              autoArmed
                ? `AUTO armed — the crossfader's < / > cross-fade over ${fadeBeats} beats, swapping the lows at the midpoint. Click to disarm.`
                : `Arm AUTO: the crossfader's < / > then cross-fade over ${fadeBeats} beats with a bass swap instead of nudging`
            }
          >
            AUTO
          </button>

          <div className="w-[200px] flex items-center justify-between gap-1.5 px-2.5 py-1 bg-[#141414] rounded-lg border border-[#282828]">
            <button
              type="button"
              onClick={() => pressCrossfadeArrow('left')}
              className={`text-xs font-bold rounded px-1 py-0.5 transition-all select-none ${
                isFading === 'left'
                  ? 'bg-[#34d399]/20 text-[#34d399] shadow-[0_0_8px_rgba(52,211,153,0.3)] animate-pulse'
                  : 'text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222]'
              }`}
              title={
                isFading === 'left'
                  ? 'Stop auto-fade'
                  : autoArmed
                    ? `Cross-fade to Deck A over ${fadeBeats} beats`
                    : 'Nudge Crossfader toward Deck A'
              }
            >
              &lt;
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
              className="h-6 w-[140px] max-w-[140px]"
            />

            <button
              type="button"
              onClick={() => pressCrossfadeArrow('right')}
              className={`text-xs font-bold rounded px-1 py-0.5 transition-all select-none ${
                isFading === 'right'
                  ? 'bg-[#a855f7]/20 text-[#a855f7] shadow-[0_0_8px_rgba(168,85,247,0.3)] animate-pulse'
                  : 'text-[#666666] hover:text-[#d4d4d4] hover:bg-[#222222]'
              }`}
              title={
                isFading === 'right'
                  ? 'Stop auto-fade'
                  : autoArmed
                    ? `Cross-fade to Deck B over ${fadeBeats} beats`
                    : 'Nudge Crossfader toward Deck B'
              }
            >
              &gt;
            </button>
          </div>

          {/* Shared auto-fade length: click to cycle 4 / 8 / 16 / 32 / 64 beats.
              Sized to the FX plate's A/MST/B buttons — 18px tall, 3px corners — so the flanks of the
              crossfader read as the same grade of control as the rest of the console. Its numeral is
              a value rather than a label, so it keeps the console's value size (9px, as in the grid
              panel) instead of AUTO's 7.5px label grade, and 30px wide is the FX plate's button
              footprint: the digits are far narrower, so the box stays put as the value cycles 4 → 64. */}
          <button
            type="button"
            onClick={cycleFadeBeats}
            aria-label={`Auto-fade length: ${fadeBeats} beats`}
            className="absolute left-full ml-2 top-1/2 -translate-y-1/2 h-[18px] min-w-[30px] px-1.5 rounded-[3px] border border-[#282828] bg-[#141414] text-[#777777] hover:text-[#d4d4d4] hover:border-[#444444] font-mono text-[9px] font-bold leading-none flex items-center justify-center transition-colors"
            title={`Auto-fade length: ${fadeBeats} beats — click to cycle 4 / 8 / 16 / 32 / 64`}
          >
            {fadeBeats}
          </button>
        </div>
      </div>

      {/* ================= DECK B TRANSPORT (RIGHT) ================= */}
      <div className="flex items-center justify-end">
        <DeckTransport deck={deckB} deckId="B" />
      </div>
    </div>
  )
}

const LOOP_BEAT_SIZES = [1, 2, 4, 8, 16, 32]

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
const ARROW_PRESS = 'active:bg-[#2b2b2b] active:text-white active:transition-none'

/**
 * The LOOP and MOVE switches are the same control with a different bit of state
 * behind them, so they share one look outright rather than two class strings that
 * happen to match. The on branch carries its own hover: a switch that is already
 * white would otherwise go dead under the cursor while its neighbour lit up.
 */
const SWITCH_BASE =
  'w-full rounded-[4px] border bg-[#141414] text-[8px] font-bold uppercase tracking-wider leading-none transition-colors disabled:opacity-40'
const SWITCH_ON = 'border-white text-white hover:bg-white/10'
const SWITCH_OFF =
  'border-[#2b2b2b] text-[#6f6f6f] hover:text-[#d4d4d4] hover:border-[#444444]'

/**
 * One solid triangle, sized 7 × 8 px, for the loop cluster's arrows.
 *
 * Drawn with borders rather than set as `‹` / `›` or `◀` / `▶`: the text glyph is whatever the
 * font supplies at whatever optical size it likes, which on Windows falls back to a different
 * shape from the one on macOS, and the triangle here is a control affordance that should be the
 * same everywhere. `border-*-current` makes it follow the button's text colour, so hover and press
 * light it without a second rule.
 */
const TRIANGLE_LEFT =
  'block h-0 w-0 border-y-[4px] border-y-transparent border-r-[7px] border-r-current'
const TRIANGLE_RIGHT =
  'block h-0 w-0 border-y-[4px] border-y-transparent border-l-[7px] border-l-current'

function DeckTransport({ deck, deckId }: { deck: DeckEngine; deckId: 'A' | 'B' }) {
  const [selectedLoopIdx, setSelectedLoopIdx] = useState(2) // Default 4 beats
  // What the < number > cluster under the switch does: size and toggle a loop, or beat-jump the
  // playhead. Kept per deck, like the size, so the two transports can be set up differently.
  // MOVE is a toggle of its own rather than a mode: on makes the arrows jump the playhead, off
  // makes them resize the loop.
  const [moveOn, setMoveOn] = useState(false)
  const currentBeats = LOOP_BEAT_SIZES[selectedLoopIdx]
  const isPlaying = deck.playing
  const isLoopActive = Boolean(deck.loop)

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
      const start = deck.snapMode ? deck.snapToBeat(deck.position) : deck.position
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
    if (moveOn) {
      setMoveOn(false)
      if (deck.loop) deck.exitLoop()
    } else {
      setMoveOn(true)
    }
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
    <div className="flex items-center gap-2">
      {/* Play / Pause button matching Traktor */}
      <button
        type="button"
        onClick={handleTogglePlay}
        disabled={!isDeckReady}
        className={`h-11 w-14 rounded-md border flex items-center justify-center transition-all shadow-sm select-none ${
          isPlayingActive
            ? 'bg-[#141414] border-white text-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
            : 'bg-[#141414] border-[#282828] text-[#666666] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-40'
        }`}
        title={`Deck ${deckId} Play / Pause (Space / Click)`}
      >
        <span className="text-base font-bold">▶</span>
      </button>

      {/* CUE button matching Traktor */}
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
        className={`h-11 px-4 rounded-md border text-xs font-bold uppercase tracking-wider flex items-center justify-center transition-all shadow-sm select-none ${
          deck.cuePreviewing
            ? 'bg-amber-500/30 border-amber-400 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
            : isPlayingActive
            ? 'bg-[#141414] border-[#282828] text-[#555555] hover:text-[#d4d4d4] hover:border-[#444444]'
            : 'bg-[#161616] border-[#383838] text-amber-400/90 hover:text-amber-300 hover:border-amber-500/60'
        } disabled:opacity-40`}
        title={`Deck ${deckId} Cue (Hold to preview, release to snap back)`}
      >
        CUE
      </button>

      {/* Loop / Move: the LOOP and MOVE switches side by side in a column, then the loop-length
          cluster as its own bordered group. The switches and the cluster used to be one box with
          a switch row inside it, which made LOOP/MOVE read as the cluster's own tabs; separating
          them says what they are — two switches over one cluster, not a mode for the box.

          One pair of arrows with two jobs, because a bar this tight cannot afford a second row:
          LOOP sizes and arms a loop, MOVE beat-jumps the playhead. The number is that job's
          control too — it toggles the loop under LOOP and cycles the step under MOVE. */}
      <div
        role="group"
        aria-label={`Deck ${deckId} loop and move`}
        className="flex items-center gap-2 shrink-0"
      >
        {/* 18 px each with the row's 8 px gap: the pair fills the 44 px row exactly, which is what
            keeps their outer edges on the play, CUE and TAP buttons' lines. */}
        <div className="grid h-11 w-9 shrink-0 grid-rows-2 gap-2">
          <button
            type="button"
            onClick={toggleLoop}
            aria-pressed={isLoopActive}
            className={`${SWITCH_BASE} ${isLoopActive ? SWITCH_ON : SWITCH_OFF}`}
            title={
              isLoopActive
                ? `LOOP running (${currentBeats} beats) — click to release it`
                : `LOOP: arm a ${currentBeats}-beat loop at the playhead`
            }
          >
            loop
          </button>
          <button
            type="button"
            onClick={toggleMove}
            aria-pressed={moveOn}
            className={`${SWITCH_BASE} ${moveOn ? SWITCH_ON : SWITCH_OFF}`}
            title={
              moveOn
                ? 'MOVE on — the arrows beat-jump the playhead (a running loop travels with it), the number cycles the step'
                : 'MOVE: the arrows beat-jump the playhead by the step (also releases the loop when switched off)'
            }
          >
            move
          </button>
        </div>

        {/* 26 px cells at the ends, so the number gets 52 of the 106 — half the group, which is
            what lets it be set at 16 px and still read from a laptop across the desk. The middle
            cell carries the dividers as `border-x`, so the three cells and the group's own border
            are the only lines, and no cell has a box of its own. */}
        <div className="flex h-11 w-[106px] shrink-0 items-stretch overflow-hidden rounded-[4px] border border-[#2b2b2b] bg-[#141414]">
          <button
            type="button"
            onClick={moveOn ? () => beatJump(-1) : loopHalf}
            disabled={moveOn ? !deck.track : !deck.track || selectedLoopIdx === 0}
            className={`w-[26px] shrink-0 flex items-center justify-center text-[#6f6f6f] hover:text-[#d4d4d4] hover:bg-[#222222] disabled:opacity-25 transition-colors ${ARROW_PRESS}`}
            aria-label={
              moveOn
                ? `Jump the playhead back ${currentBeats} beats`
                : 'Half loop length'
            }
            title={
              moveOn
                ? `Jump the playhead back ${currentBeats} beats (a running loop comes with it)`
                : 'Half loop length (÷2)'
            }
          >
            <span className={TRIANGLE_LEFT} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={moveOn ? cycleBeats : toggleLoop}
            disabled={!deck.track}
            className={`flex-1 flex items-center justify-center border-x border-[#2b2b2b] transition-colors text-[16px] font-mono font-bold leading-none disabled:opacity-40 ${
              isLoopActive && !moveOn
                ? 'bg-accent/25 text-white'
                : 'hover:bg-[#222222] text-[#5c5c5c] hover:text-[#d4d4d4]'
            }`}
            aria-label={
              moveOn ? `${currentBeats}-beat jump step` : `Loop ${currentBeats} beats`
            }
            title={
              moveOn
                ? `${currentBeats}-beat jump step — click to cycle the size`
                : `Loop ${currentBeats} beats (Click to toggle)`
            }
          >
            {currentBeats}
          </button>

          <button
            type="button"
            onClick={moveOn ? () => beatJump(1) : loopDouble}
            disabled={
              moveOn ? !deck.track : !deck.track || selectedLoopIdx === LOOP_BEAT_SIZES.length - 1
            }
            className={`w-[26px] shrink-0 flex items-center justify-center text-[#6f6f6f] hover:text-[#d4d4d4] hover:bg-[#222222] disabled:opacity-25 transition-colors ${ARROW_PRESS}`}
            aria-label={
              moveOn
                ? `Jump the playhead forward ${currentBeats} beats`
                : 'Double loop length'
            }
            title={
              moveOn
                ? `Jump the playhead forward ${currentBeats} beats (a running loop comes with it)`
                : 'Double loop length (×2)'
            }
          >
            <span className={TRIANGLE_RIGHT} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Tap Tempo Button: TAP (shows 4-tap counter: TAP, 1/4, 2/4, 3/4, 4/4) */}
      <button
        type="button"
        onClick={handleTapTempo}
        disabled={!deck.track}
        className={`h-11 min-w-[48px] px-2.5 rounded-md border text-[10.5px] font-bold uppercase tracking-wider flex flex-col items-center justify-center transition-all shadow-sm select-none ${
          tapCount > 0
            ? 'bg-[#222222] border-white text-white shadow-[0_0_8px_rgba(255,255,255,0.35)] scale-[0.97]'
            : 'bg-[#141414] border-[#282828] text-[#666666] hover:text-[#d4d4d4] hover:border-[#444444] disabled:opacity-40'
        }`}
        title={`Deck ${deckId} Tap Tempo — Tap 4 times in rhythm to set BPM`}
      >
        <span>TAP</span>
        {tapCount > 0 && (
          <span className="text-[8px] font-mono font-bold leading-none text-emerald-400 mt-0.5">
            {tapCount}/4
          </span>
        )}
      </button>
    </div>
  )
}
