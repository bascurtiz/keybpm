import { useEffect, useRef, useState } from 'react'
import { getAudioEngine } from '@/lib/dj/audio-engine'
import { analyzeTrackFile, type AnalyzeProgress } from '@/lib/dj/track-analyzer'
import { consumePendingDeckTrackA } from '@/lib/dj/trackTransfer'
import { computePeaks } from '@/lib/dj/peaks'
import { computeAutoGain } from '@/lib/dj/autogain'
import { StackedWaveforms } from '@/components/dj/StackedWaveforms'
import { TraktorMiddleStrip } from '@/components/dj/TraktorMiddleStrip'
import { TraktorDeck } from '@/components/dj/TraktorDeck'
import { TraktorMixer } from '@/components/dj/TraktorMixer'
import { TraktorTransportBar } from '@/components/dj/TraktorTransportBar'
import { TraktorFxDrawer } from '@/components/dj/TraktorFxDrawer'
import { ConsoleChrome, RAIL } from '@/components/dj/ConsoleChrome'
import { LoadTrackModal } from '@/components/dj/LoadTrackModal'
import { BrowserNotice } from '@/components/BrowserNotice'
import { useViewportMode } from '@/lib/use-viewport'
import { useConsoleFit, CONSOLE_WIDTH } from '@/lib/dj/use-console-fit'
import { useFullscreen, useFullscreenKeeper, enterFullscreen } from '@/lib/fullscreen'
import { useKeepScreenAwake } from '@/lib/wake-lock'
// import { YouTubeVideoOverlay } from '@/components/dj/YouTubeVideoOverlay'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

/**
 * Floor for the kiosk chassis height (design px): the metadata strip, the waveform
 * band, a deck row tall enough for the jog wheel, and the transport bar — the four
 * rows of the console, none of them clipped. See `kioskDesignH`.
 *
 * The strip and the transport are content-sized (roughly 81 px and 65 px at the
 * sizes they render), which is where the rest of this number comes from. It binds only
 * on a screen wider than 19.5:9 (or a short one), where filling the width asks for
 * less height than the rows need: a 19.5:9 phone fits at ~520 design px, so the floor
 * is headroom there rather than the active constraint.
 */
const KIOSK_MIN_CONSOLE_H = 485

/**
 * Ceiling for the same height (design px), about a 2:1 chassis.
 *
 * Without it, a tall box stretches the deck row to whatever the box allows: an iPad in
 * portrait asks for a 1444 px row, in which a 196 px jog wheel floats in a metre of
 * nothing. The row is a row of controls, not a flex container for empty space — past
 * roughly twice the wheel's height the extra height is letterboxing, so it is left to
 * the page instead.
 */
const KIOSK_MAX_CONSOLE_H = 560

/**
 * Height of the stacked waveform band in kiosk mode, in design px.
 *
 * Two lanes of 48 px: tall enough for a lane's own controls (rewind, downbeat,
 * ±10 ms, GRID) to sit in the corner above the wave without eating it, and thin
 * enough that the deck row below — the jogs, EQ and faders — still gets the bulk of
 * the ~520 design px a 19.5:9 phone's chassis has to spend. The desktop band is 290 px,
 * which on a landscape phone would be most of the screen.
 */
const KIOSK_LANE_BAND_H = 96

/**
 * Smallest deck row that holds the deck's own parts, in design px: the jog wheel is a
 * fixed 196 px, plus the deck's and the row's vertical padding. Below this the wheel
 * is clipped by the chassis, which is the one row on the console that cannot be
 * squeezed — the rest (band, strip, transport) is what gives way instead.
 */
const KIOSK_MIN_DECK_ROW_H = 243

/**
 * Side band kept clear of the console, per side, in kiosk mode.
 *
 * The menu and fullscreen buttons sit *outside* the chassis (see `ConsoleChrome`),
 * level with the deck load buttons — where the phone's rounded corners and the display
 * cutout cannot clip them. They need `RAIL.gap + RAIL.size` = 52 design px of room each
 * side, which is 4.6% of the chassis width; a band of 5.2vw leaves a few real pixels to
 * spare once the console has taken the rest of the width. On a notched phone the
 * safe-area inset is usually the larger number, and `max()` picks it — the band is
 * never narrower than the notch.
 *
 * This is a deliberate trade: the console gives up about 10% of the screen width on a
 * phone with no inset at all, and almost nothing where the browser already reserved an
 * inset (where the mock-up's black bands come from).
 */
const KIOSK_SIDE_BAND = 'max(env(safe-area-inset-left), env(safe-area-inset-right), 5.2vw)'

/**
 * Build fingerprint rendered next to the BETA chip.
 *
 * Formatted in UTC on purpose: `__BUILD_DATE__` is baked in at build time, so
 * rendering it in the viewer's local timezone would show a different string to
 * every visitor — useless for confirming which build is actually live.
 */
const BUILD_STAMP = (() => {
  const d = new Date(__BUILD_DATE__)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
})()

export function MixIt() {
  const engine = getAudioEngine()
  const deckA = engine.decks.A
  const deckB = engine.decks.B

  const [analyzingDeck, setAnalyzingDeck] = useState<'A' | 'B' | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState<AnalyzeProgress | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [dragOverDeck, setDragOverDeck] = useState<'A' | 'B' | null>(null)
  const [activeFxDeck, setActiveFxDeck] = useState<'A' | 'B' | null>(null)
  const [loadModalDeck, setLoadModalDeck] = useState<'A' | 'B' | null>(null)
  const [, setEngineVer] = useState(0)

  // Phones and tablets get the console instead of the site: the header, the page title
  // and the 24 px page padding were taking a third of a 360 px-tall landscape viewport.
  // Read from resize events, not media-query events, so the address bar sliding away
  // (or the keyboard opening) re-fits the console immediately — see `use-viewport.ts`.
  const { kiosk, portraitPhone } = useViewportMode()
  // A phone held upright is the wrong shape for a two-deck console: fitted, the
  // controls are too small to hit. So portrait opens on a rotate prompt instead.
  // Landscape fits the whole console (the mock-up's mode); a portrait tablet is wide
  // enough that fitting only costs a little type size and needs no prompt.
  // "Continue anyway" is per-rotation, not permanent: coming back from landscape
  // re-arms the prompt, so the next upright visit starts from the right advice.
  const [portraitOptOut, setPortraitOptOut] = useState(false)
  // The prompt stays out of the way while one of the console's own dialogs is open:
  // rotating mid-task (picking a file, reading the analysis bar) should not throw a
  // full-screen prompt over the thing being used.
  const showRotatePrompt =
    kiosk && portraitPhone && !portraitOptOut && loadModalDeck === null && analyzingDeck === null
  useEffect(() => {
    if (!portraitPhone) setPortraitOptOut(false)
  }, [portraitPhone])
  const { setBoxRef, setChassisRef, box, scale } = useConsoleFit()
  // Fullscreen is how the console gets the address bar back: a fixed viewport never
  // scrolls, so the browser's own hide-on-scroll never fires here (see `fullscreen.ts`).
  // The toggle lives on the side rail rather than in the console — outside the chassis it
  // costs no row and no column, which is why it can exist at all (see `ConsoleChrome`).
  // The portrait prompt asks too, because asking is a gesture and rotating is not.
  const fullscreen = useFullscreen()

  // Opening the load dialog (or the analysis one, or the FX drawer) is when Android's
  // file picker and keyboard take the screen away from fullscreen, which is what brought
  // the address bar back over the console. While any of them is up, the console asks for
  // fullscreen again on the next tap — see `useFullscreenKeeper`.
  useFullscreenKeeper(kiosk && (loadModalDeck !== null || analyzingDeck !== null || activeFxDeck !== null))

  /**
   * Rotating a phone is not a user gesture, so the browser will usually refuse a
   * fullscreen request at that moment — the prompt's "start fullscreen" button is
   * the part that is allowed to ask, and Chrome keeps fullscreen across the
   * rotation that follows. This is the one attempt for engines that do allow it,
   * so a user who simply turns the phone still lands in fullscreen where possible.
   */
  const wasPortrait = useRef(portraitPhone)
  useEffect(() => {
    if (wasPortrait.current && !portraitPhone && kiosk) void enterFullscreen()
    wasPortrait.current = portraitPhone
  }, [portraitPhone, kiosk])

  // Per-deck load generation so a finishing older analysis can't clear a newer one.
  const loadGenRef = useRef({ A: 0, B: 0 })

  useEffect(() => {
    document.title = 'Mix it! — KeyBPM DJ Player'
    if (typeof window !== 'undefined') {
      ;(window as any).__KEYBPM_ENGINE__ = engine
    }
    const unsub = engine.subscribe(() => setEngineVer(v => v + 1))
    return () => {
      unsub()
    }
  }, [engine])

  // Whether anything is actually coming out of the console. Used for the screen wake lock
  // below; deck-level rather than engine-level, because the engine does not emit for play and
  // pause. `setPlaying` with an unchanged value does not re-render.
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const sync = () => setPlaying(deckA.playing || deckB.playing)
    const unsubA = deckA.subscribe(sync)
    const unsubB = deckB.subscribe(sync)
    sync()
    return () => {
      unsubA()
      unsubB()
    }
  }, [deckA, deckB])

  // A phone that dims mid-set is a phone that also starts throttling; see `wake-lock.ts`.
  // Only in kiosk (touch) layout: a desktop browser has no such problem and no reason to
  // hold someone's screen on.
  useKeepScreenAwake(kiosk && playing)

  const handleFileSelected = async (
    targetDeckId: 'A' | 'B',
    file: File,
    precomputed?: import('@/lib/dj/track-analyzer').PrecomputedTrackData
  ) => {
    const gen = ++loadGenRef.current[targetDeckId]
    setAnalyzingDeck(targetDeckId)
    setErrorMsg(null)
    setAnalysisProgress({
      stage: 'decoding',
      progress: 0.05,
      message:
        precomputed?.key && precomputed?.bpm
          ? `Loading track for Deck ${targetDeckId}…`
          : `Analyzing track for Deck ${targetDeckId}…`,
    })

    try {
      await engine.resume()
      const analyzedTrack = await analyzeTrackFile(
        file,
        p => {
          if (loadGenRef.current[targetDeckId] !== gen) return
          setAnalyzingDeck(targetDeckId)
          setAnalysisProgress(p)
        },
        precomputed
      )

      if (loadGenRef.current[targetDeckId] !== gen) return

      // Local audio replaces any YouTube source on this deck.
      youtubeBridge.eject(targetDeckId)

      if (targetDeckId === 'A') {
        deckA.loadTrack(analyzedTrack)
      } else {
        deckB.loadTrack(analyzedTrack)
      }

      // The loaded song's BPM dictates master BPM unless the other deck is already actively playing
      const otherDeck = targetDeckId === 'A' ? deckB : deckA
      if (!otherDeck.playing && analyzedTrack.bpm) {
        engine.setMasterBpm(analyzedTrack.bpm, false)
      }
    } catch (err: unknown) {
      if (loadGenRef.current[targetDeckId] !== gen) return
      console.error('Error analyzing DJ track:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(`Failed to analyze track: ${msg}`)
    } finally {
      if (loadGenRef.current[targetDeckId] === gen) {
        setAnalyzingDeck(null)
        setAnalysisProgress(null)
      }
    }
  }

  // Auto-load track passed from KeyTagger / Auto-detect
  useEffect(() => {
    const pending = consumePendingDeckTrackA()
    if (!pending) return

    if (pending.file) {
      void handleFileSelected('A', pending.file, {
        bpm: pending.bpm,
        key: pending.keyInfo,
        metadata: pending.metadata,
      })
      return
    }

    if (pending.buffer) {
      const bpm = pending.bpm || pending.metadata?.bpm || 128
      const buffer = pending.buffer
      youtubeBridge.eject('A')
      deckA.loadTrack({
        id: `transferred-${Date.now()}`,
        title: pending.metadata?.title || 'Loaded Track',
        artist: pending.metadata?.artist || 'Unknown Artist',
        genre: pending.metadata?.genre,
        label: pending.metadata?.label,
        duration: buffer.duration,
        bpm,
        grid: {
          bpm,
          firstBeat: 0,
          firstBar: 0,
          beatsPerBar: 4,
        },
        key:
          pending.keyInfo ||
          (pending.metadata?.camelot
            ? { name: pending.metadata.key || '', camelot: pending.metadata.camelot }
            : null),
        gain: computeAutoGain(buffer),
        buffer,
        coverUrl: pending.metadata?.coverUrl,
        peaks: computePeaks(buffer),
      })
      if (bpm) {
        engine.setMasterBpm(bpm, false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot transfer on mount
  }, [deckA, engine])

  const onDrop = (targetDeckId: 'A' | 'B', e: React.DragEvent) => {
    e.preventDefault()
    setDragOverDeck(null)
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      void handleFileSelected(targetDeckId, files[0])
    }
  }

  const onDragOver = (targetDeckId: 'A' | 'B', e: React.DragEvent) => {
    e.preventDefault()
    setDragOverDeck(targetDeckId)
  }

  const onDragLeave = () => {
    setDragOverDeck(null)
  }

  const spinnerColor = analyzingDeck === 'A' ? '#34d399' : '#a855f7'

  // Kiosk layout: the chassis is measured against the box it is put in and scaled to
  // fit both axes, so the whole console is visible at its own proportions.
  // No clipping in kiosk: the rail buttons hang outside the box, into the side band.
  // Nothing else can overflow — the chassis fits the box exactly and clips itself.
  const boxClass = !kiosk
    ? 'mt-4 w-full overflow-x-auto pb-2 flex justify-center'
    : 'relative min-w-0 flex-1 min-h-0'

  const chassisClass = !kiosk
    ? 'w-[1120px] max-w-full bg-[#1C1C1C] rounded-xl border border-[#282828] shadow-2xl overflow-hidden flex flex-col shrink-0'
    : 'absolute left-1/2 top-1/2 shrink-0 bg-[#1C1C1C] overflow-hidden flex flex-col'

  /**
   * Height the kiosk chassis is laid out at, in design px.
   *
   * On a landscape phone the console is width-bound: 1120 design px across ~844 CSS px
   * of screen, so the fit can never be larger than ~0.75 whatever the height. The old
   * kiosk then letterboxed: a 556 px-tall chassis at 0.75 leaves ~55 px of the screen
   * empty, and every row above the decks was paid for out of a fixed budget. So instead
   * of a fixed height, the chassis is given the height that makes 1120 wide fill the
   * box, and the deck row (the only flexible row) takes what the strip, the waveform
   * band and the transport bar do not.
   *
   * That height is floored at `KIOSK_MIN_CONSOLE_H`, because the rows are not all
   * squeezable: the jog wheel is a fixed 196 px. An 844×390 phone (19.5:9) asks to
   * fill at 518 and gets it, so the fit is width-bound at 0.754 and the deck row gets
   * 276 design px instead of the 243 floor. A shorter screen — or a wider one — hits
   * the floor instead, which costs margin rather than clipping the wheel. Above
   * `KIOSK_MAX_CONSOLE_H` the console stops growing and the leftover height is left to
   * the page.
   */
  const kioskDesignH =
    kiosk && box.w > 0 && box.h > 0
      ? Math.min(
          KIOSK_MAX_CONSOLE_H,
          Math.max(KIOSK_MIN_CONSOLE_H, Math.round((box.h * CONSOLE_WIDTH) / box.w))
        )
      : undefined

  const chassisStyle = !kiosk
    ? undefined
    : {
        width: CONSOLE_WIDTH,
        height: kioskDesignH,
        transform: `translate(-50%, -50%) scale(${scale})`,
      }

  // Rail placement: the chassis is centred in the box and scaled, so a button's offset is
  // the chassis half-width plus the rail gap, all in *scaled* design px. Negative on the
  // left when the console fills the box — that is the side band it draws into.
  const chassisHalf = (CONSOLE_WIDTH * scale) / 2
  const railTop = (box.h - (kioskDesignH ?? 0) * scale) / 2 + RAIL.top * scale
  const hamburgerLeft = box.w / 2 - chassisHalf - (RAIL.gap + RAIL.size) * scale
  const fullscreenLeft = box.w / 2 + chassisHalf + RAIL.gap * scale

  /**
   * Room kept clear on each side, in real CSS px: the display cutout, and the band the
   * rail buttons live in.
   *
   * The console is drawn edge to edge, so on a landscape phone with the camera in the
   * corner its outermost column — the pitch fader, which is exactly the control a thumb
   * reaches for — would sit under the cutout. Both sides get the *larger* of the two
   * insets so the console stays centred on the screen: padding each side with its own
   * inset would shift it by half the difference, which is the leaning jogs the old side
   * rails were fixed for. The same `max()` also guarantees the band the menu and
   * fullscreen buttons hang in, so they are never under the notch or the rounded corner.
   */
  const safeEdge = KIOSK_SIDE_BAND

  return (
    <div
      className={
        kiosk
          ? 'fixed inset-x-0 top-0 z-30 flex h-[100dvh] flex-col overflow-hidden bg-bg select-none text-text'
          : 'flex flex-col min-h-[calc(100vh-var(--header-h,64px))] bg-bg select-none text-text'
      }
      style={
        kiosk
          ? {
              paddingLeft: safeEdge,
              paddingRight: safeEdge,
              // Only a real cutout at the top costs space: in landscape the notch is on
              // the side (handled above) and this resolves to 0, so the whole height
              // goes to the console. There is no bar above it either: the two controls
              // the console does draw (menu, fullscreen) sit on the side rail, where
              // they cost the fit nothing, rather than in a row worth ~38 px of it.
              paddingTop: 'env(safe-area-inset-top)',
            }
          : undefined
      }
    >
      {/* Main DJ Console Workspace - Compact hardware layout matching real DJ controllers */}
      <main
        className={
          kiosk
            ? 'relative flex-1 flex flex-col min-h-0 min-w-0'
            : 'flex-1 flex flex-col max-w-[1160px] w-full mx-auto px-4 py-6'
        }
      >
        {/* Page Title Row — desktop only: in kiosk mode every row above the console
            costs transport space, which is the scarcest thing on a phone. */}
        {!kiosk && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white tracking-wide">Mix it!</h1>
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
              Beta
            </span>
            <span
              className={`text-[10px] font-mono font-medium tracking-wider px-1.5 py-0.5 rounded border tabular-nums ${
                __GIT_DIRTY__
                  ? 'bg-warn/10 text-warn border-warn/30'
                  : 'bg-white/5 text-text-muted border-white/10'
              }`}
              title={[
                `Version: ${__APP_VERSION__}`,
                `Built:   ${BUILD_STAMP}`,
                `Commit:  ${__GIT_SHA__}`,
                `Branch:  ${__GIT_BRANCH__}`,
                __GIT_DIRTY__ ? 'Note:    built with uncommitted changes' : null,
              ]
                .filter(Boolean)
                .join('\n')}
            >
              v{__APP_VERSION__} · {BUILD_STAMP}
            </span>
          </div>
          <p className="text-xs text-text-muted text-right">
            Drop a track on each deck, and audition quickly in the mix.
          </p>
        </div>
        )}

        {/* Safari: the console's audio paths are not supported there (see `isSafari`). */}
        <BrowserNotice className={kiosk ? 'mx-1 mt-1 shrink-0' : 'mt-3'} />

        {/* Error notification banner if any */}
        {errorMsg && (
          <div
            className={`${
              kiosk ? 'absolute left-2 right-2 top-2 z-30' : 'mt-4'
            } p-2.5 rounded-lg bg-bad/10 border border-bad/30 text-bad text-xs flex items-center justify-between backdrop-blur-sm`}
          >
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-bad hover:text-text px-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Single Seamless Traktor DJ Hardware Chassis. In kiosk mode the console is
            the page: it is measured against the viewport and scaled or panned to fit. */}
        <div ref={kiosk ? setBoxRef : undefined} className={boxClass}>
          <div ref={kiosk ? setChassisRef : undefined} className={chassisClass} style={chassisStyle}>
            {/* YouTube VJ decks - hidden for now */}
            {/* <YouTubeVideoOverlay
              crossfade={engine.crossfade}
              onEjectDeck={deckId => {
                youtubeBridge.eject(deckId)
              }}
              onOpenLoadModal={deckId => setLoadModalDeck(deckId)}
            /> */}

            {/* 1. TOP STRIP: METADATA, COLOR-CODED KEY & BPM, MINI WAVEFORMS, BEAT COUNTER */}
            <TraktorMiddleStrip
              engine={engine}
              onLoadTrackClick={deckId => setLoadModalDeck(deckId)}
              onToggleFx={deckId => {
                setActiveFxDeck(current => (current === deckId ? null : deckId))
              }}
              activeFxDeck={activeFxDeck}
            />

            {/* 2. OPTIONAL FX DRAWER. Desktop gives it a row of its own. In kiosk it
                floats over the metadata strip instead: the rows there are already at
                their floors, and a drawer that took a row would clip the jog wheel. */}
            {activeFxDeck && (
              <div
                className={
                  kiosk
                    ? 'absolute inset-x-0 top-0 z-40 shadow-[0_10px_20px_rgba(0,0,0,0.55)]'
                    : undefined
                }
              >
                <TraktorFxDrawer
                  deck={activeFxDeck === 'A' ? deckA : deckB}
                  deckId={activeFxDeck}
                  accentColor={activeFxDeck === 'A' ? '#34d399' : '#a855f7'}
                  onClose={() => setActiveFxDeck(null)}
                />
              </div>
            )}

            {/* 3. FULL-WIDTH STACKED SCROLLING WAVEFORMS.

                Same arrangement on both sides of the breakpoint — the lanes are the
                instrument's horizon line, and a phone that buried them in the mixer
                column had to bend one deck's controls around the other's. What changes
                in kiosk is only the height: 290 design px is a comfortable band on a
                desktop and more than half of a landscape phone's screen, so the kiosk
                band is `KIOSK_LANE_BAND_H`, and the deck row takes what is left. */}
            <div
              className={`w-full shrink-0 border-b border-[#282828] bg-[#161616] ${
                kiosk ? '' : 'h-[290px]'
              }`}
              style={kiosk ? { height: KIOSK_LANE_BAND_H } : undefined}
            >
              <StackedWaveforms
                deckA={deckA}
                deckB={deckB}
                onDropFile={(targetDeckId, file) => void handleFileSelected(targetDeckId, file)}
                onLoadClick={deckId => setLoadModalDeck(deckId)}
                className="h-full w-full rounded-none border-none"
              />
            </div>

            {/* 4. MAIN CONSOLE SURFACE: DECK A (GREEN) | 2-COLUMN MIXER | DECK B (PURPLE) */}
            <div
              className={`grid grid-cols-[1fr_auto_1fr] items-stretch justify-center px-3 py-2 bg-[#1C1C1C] gap-4 ${
                kiosk ? 'flex-1 min-h-0' : 'h-[280px]'
              }`}
              style={kiosk ? { minHeight: KIOSK_MIN_DECK_ROW_H } : undefined}
            >
              {/* Deck A Control Section (Green) */}
              <div
                onDrop={e => onDrop('A', e)}
                onDragOver={e => onDragOver('A', e)}
                onDragLeave={onDragLeave}
                className={`flex items-stretch justify-center h-full transition-all rounded-[4px] ${
                  dragOverDeck === 'A' ? 'ring-1 ring-emerald-500 bg-emerald-500/5' : ''
                }`}
              >
                <TraktorDeck
                  deck={deckA}
                  otherDeck={deckB}
                  deckId="A"
                  side="left"
                  accentColor="#34d399"
                  onLoadClick={() => setLoadModalDeck('A')}
                />
              </div>

              {/* Central 5-Column Traktor Mixer: filters over the FX block, both decks' EQ
                  and faders either side. Same columns at every size — see `TraktorMixer`. */}
              <div className="flex items-stretch h-full justify-center w-[380px]">
                <TraktorMixer engine={engine} className="w-full" />
              </div>

              {/* Deck B Control Section (Purple) */}
              <div
                onDrop={e => onDrop('B', e)}
                onDragOver={e => onDragOver('B', e)}
                onDragLeave={onDragLeave}
                className={`flex items-stretch justify-center h-full transition-all rounded-[4px] ${
                  dragOverDeck === 'B' ? 'ring-1 ring-purple-500 bg-purple-500/5' : ''
                }`}
              >
                <TraktorDeck
                  deck={deckB}
                  otherDeck={deckA}
                  deckId="B"
                  side="right"
                  accentColor="#a855f7"
                  onLoadClick={() => setLoadModalDeck('B')}
                />
              </div>
            </div>

            {/* 5. BOTTOM TRANSPORT BAR: PLAY / CUE / LOOP < 4 BEATS > | CROSSFADER */}
            <TraktorTransportBar engine={engine} className={kiosk ? 'shrink-0' : undefined} />
          </div>

          {/* The console's only chrome: menu and fullscreen, outside the chassis, level
              with the load buttons. Desktop has the site header for both, so this is
              kiosk-only. */}
          {kiosk && box.w > 0 && (
            <ConsoleChrome
              scale={scale}
              top={railTop}
              menuLeft={hamburgerLeft}
              fullscreenLeft={fullscreenLeft}
              fullscreen={fullscreen}
            />
          )}
        </div>
      </main>

      {/* Analysis Progress Modal */}
      {analyzingDeck && analysisProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-line bg-[#1C1C1C] p-5 shadow-2xl text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-sm font-bold text-white">
              <div
                className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: spinnerColor, borderTopColor: 'transparent' }}
              />
              <span>Loading Deck {analyzingDeck}</span>
            </div>
            <p className="text-xs text-text-muted">{analysisProgress.message}</p>
            <div className="mx-auto h-2 w-full overflow-hidden rounded-full bg-[#222222]">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${Math.round(analysisProgress.progress * 100)}%`,
                  backgroundColor: spinnerColor,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Load Track modal — local file, catalogue, or hand off a YouTube link */}
      <LoadTrackModal
        isOpen={loadModalDeck !== null}
        deckId={loadModalDeck || 'A'}
        otherDeckBpm={
          loadModalDeck === 'A'
            ? (deckB.track?.bpm ?? youtubeBridge.state.B.bpm)
            : (deckA.track?.bpm ?? youtubeBridge.state.A.bpm)
        }
        otherDeckCamelot={
          loadModalDeck === 'A'
            ? (deckB.track?.key?.camelot ?? youtubeBridge.state.B.camelot)
            : (deckA.track?.key?.camelot ?? youtubeBridge.state.A.camelot)
        }
        onClose={() => setLoadModalDeck(null)}
        onLoadLocalFile={handleFileSelected}
      />

      {/* Portrait phone: the console is built for landscape, so say so instead of
          opening on a third of a mixer. The decks stay mounted underneath — loading a
          track, or an analysis already running, is not interrupted by this prompt. */}
      {showRotatePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rotate-prompt-title"
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-bg px-6 text-center"
          style={{
            paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
            paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
          }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="animate-pulse text-accent motion-reduce:animate-none"
          >
            <rect x="9" y="4.5" width="8" height="15" rx="2" />
            <path d="M12.2 17h1.6" />
            <path d="M6.4 9.2A6.8 6.8 0 0 1 16.4 3.3" />
            <path d="M5.6 6.2l0.8 3 2.9-0.8" />
          </svg>
          <div className="space-y-1.5">
            <p id="rotate-prompt-title" className="text-base font-semibold text-text">
              {fullscreen.active ? 'Now turn your screen' : 'Turn your screen'}
            </p>
            <p className="mx-auto max-w-[19rem] text-sm leading-relaxed text-text-muted">
              {fullscreen.active
                ? 'Fullscreen is on — rotate your phone and the console comes back edge to edge.'
                : 'The two-deck console needs landscape. Start fullscreen first, then rotate: the browser can only drop its address bar from a tap.'}
            </p>
          </div>
          {fullscreen.supported && !fullscreen.active && (
            <button
              type="button"
              onClick={fullscreen.toggle}
              className="btn-primary touch-manipulation px-4 py-2.5 text-sm"
            >
              Start fullscreen, then turn
            </button>
          )}
          <button
            type="button"
            onClick={() => setPortraitOptOut(true)}
            className="text-[11px] font-mono uppercase tracking-wider text-text-dim underline underline-offset-4 transition-colors hover:text-text-muted"
          >
            Continue anyway
          </button>
        </div>
      )}
    </div>
  )
}
