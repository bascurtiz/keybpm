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
import { useConsoleFit, CONSOLE_WIDTH, KIOSK_CONSOLE_WIDTH } from '@/lib/dj/use-console-fit'
import { useFullscreen, useFullscreenKeeper, enterFullscreen } from '@/lib/fullscreen'
import { useKeepScreenAwake } from '@/lib/wake-lock'
// import { YouTubeVideoOverlay } from '@/components/dj/YouTubeVideoOverlay'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

/**
 * Floor for the stacked waveform band in kiosk mode, in design px: two tall lanes of 90 px,
 * giving the bigger waveform displays prominent height on mobile instead of being squeezed.
 */
const KIOSK_LANE_BAND_FLOOR_H = 180

/**
 * Ceiling for the same band, in design px: two 145 px lanes.
 */
const KIOSK_LANE_BAND_MAX_H = 290

/**
 * Height of the deck and mixer row, in design px.
 * On desktop, this is 270 px so that the mixer elements are larger and the
 * deck row matches the height of the waveform section.
 */
const DESKTOP_DECK_ROW_H = 270
const KIOSK_DECK_ROW_H = 250

/**
 * Bounds for the kiosk chassis height, in design px, derived from the band's own.
 *
 * The metadata strip (~87 px) and the transport bar (~65 px) are content-sized and the
 * two rows between them are constants, so the console at the band's floor is 545 px and
 * the ceiling is exactly as much taller as the band is allowed to be. This is the pair
 * `kioskDesignH` clamps the fill-to-width height into: a landscape phone lands inside
 * them and fills its screen, and a short or unusually wide one lands on the floor and
 * is scaled down to fit instead of clipping a row.
 */
/** Height of the metadata strip at the top of the chassis, in design px (content-sized). */
const DESKTOP_STRIP_H = 98
const STRIP_H = 99

/** The chassis' own top and bottom border, in design px (1 px each). */
const CHASSIS_BORDER_H = 2

/** Height of the stacked waveform section on desktop, matching the deck and mixer row. */
const DESKTOP_WAVEFORM_H = 270

/**
 * `TraktorTransportBar`'s height in design px on a desktop: the 1 px divider, 16 px of air
 * above the keys, the 44 px keys, and 16 px of air below them (77 px total).
 * Kiosk keeps 70 px (8 px top air, 46 px keys, 16 px bottom air matching the top header's breathing room).
 */
const DESKTOP_TRANSPORT_H = 77
const KIOSK_TRANSPORT_H = 70

const KIOSK_MIN_CONSOLE_H = STRIP_H + KIOSK_LANE_BAND_FLOOR_H + KIOSK_DECK_ROW_H + KIOSK_TRANSPORT_H
const KIOSK_MAX_CONSOLE_H = KIOSK_MIN_CONSOLE_H + (KIOSK_LANE_BAND_MAX_H - KIOSK_LANE_BAND_FLOOR_H)

/**
 * Bounds for the desktop chassis.
 * Desktop matches the waveform section and mixer row at 270 px each.
 */
const DESKTOP_MIN_CONSOLE_H =
  CHASSIS_BORDER_H + DESKTOP_STRIP_H + KIOSK_LANE_BAND_FLOOR_H + DESKTOP_DECK_ROW_H + DESKTOP_TRANSPORT_H
const DESKTOP_MAX_CONSOLE_H =
  CHASSIS_BORDER_H + DESKTOP_STRIP_H + DESKTOP_WAVEFORM_H + DESKTOP_DECK_ROW_H + DESKTOP_TRANSPORT_H

/**
 * The build stamp is rendered from a value the bundler bakes in at build time, so this is
 * a constant of the bundle rather than of the session: it says when the deploy was made,
 * which is the question a BETA player has to be able to answer about itself.
 *
 * It is pinned to Europe/Amsterdam rather than UTC so it matches the wall clock of
 * whoever runs the deploy — and carries the `CEST`/`CET` suffix, so the offset is
 * explicit instead of implied, on either side of daylight saving.
 */
const BUILD_TIME_ZONE = 'Europe/Amsterdam'

const BUILD_STAMP = (() => {
  const d = new Date(__BUILD_DATE__)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUILD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(d)
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`
})()

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
const KIOSK_SIDE_BAND =
  'max(env(safe-area-inset-left), env(safe-area-inset-right), min(5.2vw, 56px))'

/**
 * Ceiling on how large the console is drawn, in design px per CSS px.
 *
 * The console fills the viewport on every screen now, so on a wide window it is drawn
 * larger than the 1024 px it was laid out at — the same thing the design mock-up does on
 * a 1610 px-wide screenshot. The ceiling is only there so an ultra-wide display gets a
 * centred console instead of a mixer with 90 px knobs.
 */
const MAX_CONSOLE_SCALE = 2

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
  const { kiosk, portraitPhone, touch } = useViewportMode()
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
    portraitPhone && !portraitOptOut && loadModalDeck === null && analyzingDeck === null
  useEffect(() => {
    if (!portraitPhone) setPortraitOptOut(false)
  }, [portraitPhone])
  // A desktop draws the console at its own size: 1190 px is the instrument's design
  // width, and scaling it up to fill a 1600 px window is what made the page read as a
  // phone console blown up — every label, knob and jog 1.3–1.5× its intended size. A
  // wide screen gets the console centred with margin around it instead; only kiosk
  // (a phone, where the console *is* the page and there is no margin to speak of)
  // still scales up past 1.
  //
  // Kiosk keeps its own design width: it fits the console to the phone's width, so the
  // desktop's wider chassis would only shrink every control on a screen that cannot
  // spare the pixels. See `KIOSK_CONSOLE_WIDTH`.
  const consoleWidth = kiosk ? KIOSK_CONSOLE_WIDTH : CONSOLE_WIDTH
  const { setBoxRef, setChassisRef, box, chassis, scale } = useConsoleFit(
    consoleWidth,
    kiosk ? MAX_CONSOLE_SCALE : 1
  )
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
  useFullscreenKeeper(touch && (loadModalDeck !== null || analyzingDeck !== null || activeFxDeck !== null))

  /**
   * Rotating a phone is not a user gesture, so the browser will usually refuse a
   * fullscreen request at that moment — the prompt's "start fullscreen" button is
   * the part that is allowed to ask, and Chrome keeps fullscreen across the
   * rotation that follows. This is the one attempt for engines that do allow it,
   * so a user who simply turns the phone still lands in fullscreen where possible.
   */
  const wasPortrait = useRef(portraitPhone)
  useEffect(() => {
    if (wasPortrait.current && !portraitPhone) void enterFullscreen()
    wasPortrait.current = portraitPhone
  }, [portraitPhone])

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
  // Only where there is a finger: a desktop browser has no such problem and no reason to
  // hold someone's screen on.
  useKeepScreenAwake(touch && playing)

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

  // The chassis is measured against the box it is put in and scaled to fit both axes, so
  // the whole console is visible at its own proportions.
  // No clipping: the rail buttons hang outside the box, into the side band. Nothing else
  // can overflow — the chassis fits the box exactly and clips itself.
  const boxClass = 'relative min-w-0 flex-1 min-h-0'

  /**
   * The chassis hangs from the top of its box on a desktop, and stays centred in it in
   * kiosk mode.
   *
   * Centring a console that is shorter than the space it was given (692 design px is the
   * ceiling on the waveform band) left it floating in the middle of the window with a band
   * of empty page above it. A desktop page reads top-down — heading, description, then the
   * instrument — so the console is anchored under the description and the space it does not
   * need stays below it, where it is not mistaken for a margin the console failed to fill.
   * On a phone the console *is* the page and fills the screen, so centring is a no-op there
   * and the rail it hangs in (`railTop`, below) is still computed from that same centre.
   */
  const chassisClass = `absolute left-1/2 shrink-0 bg-[#1C1C1C] overflow-hidden flex flex-col ${
    kiosk ? 'top-1/2' : 'top-0'
  } ${
    // One outline around the whole console, the same `surface` treatment the Key Tool
    // cards and every other panel on the site use (1 px `--line`, card radius), so the
    // instrument reads as one object on the page instead of a slab whose edges are
    // defined only by where its rows happen to stop. Desktop only: on a phone the
    // console fills the screen edge to edge (see `kioskDesignH`), and a border there
    // would inset the instrument from the glass for no reason.
    kiosk ? '' : 'border border-line rounded-card'
  }`

  /**
   * Height the kiosk chassis is laid out at, in design px.
   *
   * On a landscape phone the fit is width-bound, so the console is given the height that
   * makes 1120 design px fill the box, clamped to `KIOSK_MIN_CONSOLE_H`..
   * `KIOSK_MAX_CONSOLE_H`: a phone therefore fills its screen edge to edge, and a box
   * too short for the rows (or one so tall that the *band* would have to grow past its
   * ceiling) lands on a bound instead and is letterboxed rather than clipped.
   *
   * Every row but the waveform band is a fixed height, so "given the height" means the
   * band gets it: the strip, the deck row and the transport bar are laid out at their
   * own sizes and the band takes the remainder — which is why the deck row had to stop
   * being the flexible one. See `KIOSK_DECK_ROW_H`.
   *
   * `useConsoleFit` observes the chassis it measures, so this height and the fit agree
   * even on the frame the rows change theirs.
   *
   * The floor stands in for the fill until the box has been measured, so the chassis has a
   * definite height from its first paint. That matters now that the band is the flexible
   * row: with an indefinite chassis height the lane canvas would fall back to its own
   * `height` attribute — i.e. how tall the previous frame drew it — and the fit would
   * measure that instead of the layout.
   */
  const kioskDesignH = Math.min(
    KIOSK_MAX_CONSOLE_H,
    Math.max(
      KIOSK_MIN_CONSOLE_H,
      box.w > 0 && box.h > 0 ? Math.round((box.h * consoleWidth) / box.w) : KIOSK_MIN_CONSOLE_H
    )
  )

  /**
   * Height the chassis is laid out at, in design px.
   *
   * Kiosk keeps `kioskDesignH`: there the fit is width-bound, so the height that makes the
   * 1024 px console fill the screen is the one that matters. A desktop draws the console
   * at 1× (see the `maxScale` argument), which means design px *are* CSS px — so filling
   * the window vertically means taking the box height directly, and the flexible waveform
   * band absorbs it up to `DESKTOP_MAX_CONSOLE_H`. Without this the desktop console stayed
   * at its minimum height and floated in the middle of a 900 px window, and below that
   * minimum the band was pushed past its floor and the transport clipped.
   */
  const designH =
    kiosk || box.h <= 0
      ? kioskDesignH
      : Math.min(DESKTOP_MAX_CONSOLE_H, Math.max(DESKTOP_MIN_CONSOLE_H, Math.round(box.h)))

  const chassisStyle = {
    width: consoleWidth,
    height: designH,
    // The origin is the corner the transform anchors against: centre for the kiosk
    // `translate(-50%, -50%)`, top-centre for the desktop `translate(-50%, 0)`. With a
    // centre origin the desktop console would shrink towards its middle — a scaled-down
    // console drifts down by `(1 - scale) · height / 2` and hangs out of the box.
    transformOrigin: kiosk ? '50% 50%' : '50% 0',
    transform: `translate(-50%, ${kiosk ? '-50%' : '0'}) scale(${scale})`,
  }

  // Rail placement: the chassis is centred in the box and scaled, so a button's offset is
  // the chassis half-width plus the rail gap, all in *scaled* design px. Negative on the
  // left when the console fills the box — that is the side band it draws into.
  const chassisHalf = (consoleWidth * scale) / 2
  // Placed against the chassis as *measured* rather than as computed: the two agree —
  // `useConsoleFit` reads the same element this file gives a height to — but the
  // measured one is what the rail is actually centred against.
  const railTop = (box.h - chassis.h * scale) / 2 + RAIL.top * scale
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
    // Full-bleed, but not over the site: from lg up the header keeps its row and the
    // console takes everything below it; on a phone the bar is hidden and the console
    // starts at the top edge. `bottom-0` rather than a height, so the row the header
    // takes is whatever it actually measured.
    <div
      className="fixed inset-x-0 top-0 bottom-0 z-30 flex flex-col overflow-hidden bg-bg select-none text-text lg:top-[var(--header-h,64px)]"
      style={{
        // A wide screen has the site header and no rail, so the console goes right to
        // the window edge; the band is only there to park the rail buttons in.
        paddingLeft: kiosk ? safeEdge : 0,
        paddingRight: kiosk ? safeEdge : 0,
        // Only a real cutout at the top costs space: in landscape the notch is on the
        // side (handled above) and this resolves to 0, so the whole height goes to the
        // console. There is no bar above it either: the two controls the console does
        // draw (menu, fullscreen) sit on the side rail, where they cost the fit
        // nothing, rather than in a row worth ~38 px of it.
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Main DJ Console Workspace - Compact hardware layout matching real DJ controllers */}
      <main className="relative flex-1 flex flex-col min-h-0 min-w-0">
        {/* Page Title Row — desktop only: in kiosk mode every row above the console
            costs transport space, which is the scarcest thing on a phone. On the desktop
            it is `shrink-0`, so the console below takes the height that is left and the
            header never competes with the chassis for the same pixels. */}
        {/* The console below is full-bleed, but the title row is not: it uses the same
            container as Key Tool (`max-w-[1400px]`, 12 px side padding, 24 px top
            padding) so the two pages' headings and descriptions sit on the same
            baseline grid. A full-bleed title row put "Mix it!" 100 px to the left of
            every other page's heading. */}
        {!kiosk && (
          <div className="mx-auto flex w-full max-w-[1400px] shrink-0 flex-wrap items-baseline justify-between gap-2 px-3 pt-6">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-white">Mix it!</h1>
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
                Beta
              </span>
              {/* Plain greyscale text, no chip chrome, committed or not: the dirty state is
                  provenance, not a warning to read at a glance, and a bordered badge next to
                  the title competed with the deck colours for attention. It still shows in the
                  tooltip. */}
              <span
                className="text-[10px] font-mono font-medium tracking-wider tabular-nums text-text-muted"
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
        <BrowserNotice className="mx-1 mt-1 shrink-0" />

        {/* Space under the description before the console, desktop only: 16 px, the gap Key
            Tool puts between its title row and its tools (the page's 8 px column gap plus
            `.kt-tools`' own 8 px `margin-top`), which is also the `mt-4` Browse and Mix
            Finder use under their headings. It is a spacer in the column rather than
            padding on the box below, because the box is what `useConsoleFit` measures —
            padding on it would be counted as room to draw in, and the chassis is
            absolutely positioned inside it, so the offset has to come from the layout. */}
        {!kiosk && <div aria-hidden className="h-4 shrink-0" />}

        {/* Error notification banner if any */}
        {errorMsg && (
          <div
            className="absolute left-2 right-2 top-2 z-30 p-2.5 rounded-lg bg-bad/10 border border-bad/30 text-bad text-xs flex items-center justify-between backdrop-blur-sm"
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

        {/* Single Seamless Traktor DJ Hardware Chassis. The console is the page: it is
            measured against the viewport and scaled to fit. */}
        <div ref={setBoxRef} className={boxClass}>
          <div ref={setChassisRef} className={chassisClass} style={chassisStyle}>
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
              showFx={!kiosk}
            />

            {/* 2. OPTIONAL FX DRAWER. It floats over the metadata strip rather than taking
                a row of its own: the rows are already at their floors, and a drawer that
                took a row would clip the jog wheel. */}
            {activeFxDeck && (
              <div className="absolute inset-x-0 top-0 z-40 shadow-[0_10px_20px_rgba(0,0,0,0.55)]">
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
                in the layout is only its height: 290 design px is a comfortable band on a
                wide screen and more than half of a landscape phone's screen, so it is the
                row that takes what the fixed rows leave and the console goes back to
                filling the screen — `KIOSK_LANE_BAND_FLOOR_H` is only its floor. */}
            <div
              className={`w-full min-h-0 border-b border-[#282828] bg-[#101010] ${
                kiosk ? 'flex-1' : 'shrink-0'
              }`}
              style={{
                height: kiosk ? undefined : DESKTOP_WAVEFORM_H,
                minHeight: KIOSK_LANE_BAND_FLOOR_H,
              }}
            >
              <StackedWaveforms
                deckA={deckA}
                deckB={deckB}
                onDropFile={(targetDeckId, file) => void handleFileSelected(targetDeckId, file)}
                onLoadClick={deckId => setLoadModalDeck(deckId)}
                className="h-full w-full rounded-none border-none"
              />
            </div>

            {/* 4. MAIN CONSOLE SURFACE: DECK A | MIXER | DECK B */}
            <div
              className={`flex shrink-0 items-center justify-center bg-[#1C1C1C] ${
                // The wide layout is the roomier of the two: the components' desktop
                // variants are sized for this padding, and swapping it for the phone's
                // tighter one would leave them short of the chassis width.
                kiosk ? 'px-2 py-1 gap-2' : 'px-[14px] py-2 gap-[24px]'
              }`}
              style={{ height: kiosk ? KIOSK_DECK_ROW_H : DESKTOP_DECK_ROW_H }}
            >
              {/* Deck A Control Section (Green) */}
              <div
                onDrop={e => onDrop('A', e)}
                onDragOver={e => onDragOver('A', e)}
                onDragLeave={onDragLeave}
                className={`flex items-center h-full transition-all rounded-[4px] shrink-0 ${
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

              {/* Central 5-Column Traktor Mixer */}
              <div className="flex items-stretch h-full justify-center shrink-0">
                <TraktorMixer engine={engine} className="h-full" />
              </div>

              {/* Deck B Control Section (Purple) */}
              <div
                onDrop={e => onDrop('B', e)}
                onDragOver={e => onDragOver('B', e)}
                onDragLeave={onDragLeave}
                className={`flex items-center h-full transition-all rounded-[4px] shrink-0 ${
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
            <TraktorTransportBar engine={engine} className="shrink-0" />
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
