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
import { LoadTrackModal } from '@/components/dj/LoadTrackModal'
import { BrowserNotice } from '@/components/BrowserNotice'
import { Link } from 'react-router-dom'
import { useViewportMode } from '@/lib/use-viewport'
import { useConsoleFit, CONSOLE_WIDTH, type ConsoleFit } from '@/lib/dj/use-console-fit'
import { useFullscreen } from '@/lib/fullscreen'
// import { YouTubeVideoOverlay } from '@/components/dj/YouTubeVideoOverlay'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

/**
 * Pages worth reaching from the console on a phone, where the site header is hidden.
 * Kept short on purpose: this is a way out and back, not a second navigation system.
 */
const KIOSK_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/browse', label: 'Browse tracks' },
  { to: '/mix', label: 'Mix Finder' },
  { to: '/key', label: 'Key Wheel' },
  { to: '/tool', label: 'Key Tool' },
  { to: '/about', label: 'About' },
]

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
  // A phone held upright is the wrong shape for a two-deck console: at fit size the
  // controls are too small to hit, and at 1:1 you see one of the three panels at a
  // time and have to pan between the decks and the mixer. So portrait opens on a
  // rotate prompt instead, with 1:1 behind it for anyone who cannot turn the phone.
  // Landscape fits the whole console (the mock-up's mode); a portrait tablet is wide
  // enough that fitting only costs a little type size and needs no prompt.
  const [fitChoice, setFitChoice] = useState<ConsoleFit | null>(null)
  const fitMode: ConsoleFit = fitChoice ?? (portraitPhone ? 'actual' : 'fit')
  // "Continue anyway" is per-rotation, not permanent: coming back from landscape
  // re-arms the prompt, so the next upright visit starts from the right advice.
  const [portraitOptOut, setPortraitOptOut] = useState(false)
  const showRotatePrompt = kiosk && portraitPhone && !portraitOptOut
  useEffect(() => {
    if (!portraitPhone) setPortraitOptOut(false)
  }, [portraitPhone])
  const { setBoxRef, setChassisRef, scale } = useConsoleFit(fitMode)
  const [menuOpen, setMenuOpen] = useState(false)
  // Fullscreen is how the console gets the address bar back: a fixed viewport never
  // scrolls, so the browser's own hide-on-scroll never fires here (see `fullscreen.ts`).
  const fullscreen = useFullscreen()

  // Esc closes the console menu, matching the site drawer's behaviour.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

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

  // Kiosk layout: the chassis is measured against the box it is put in, then either
  // scaled to fit both axes (landscape — the whole console visible) or left at 1:1
  // and panned (portrait — the console's height nearly matches the screen's).
  const boxClass = !kiosk
    ? 'mt-4 w-full overflow-x-auto pb-2 flex justify-center'
    : fitMode === 'fit'
      ? 'relative w-full flex-1 min-h-0 overflow-hidden'
      : 'relative w-full flex-1 min-h-0 overflow-auto overscroll-contain'

  const chassisClass = !kiosk
    ? 'w-[1120px] max-w-full bg-[#1C1C1C] rounded-xl border border-[#282828] shadow-2xl overflow-hidden flex flex-col shrink-0'
    : fitMode === 'fit'
      ? 'absolute left-1/2 top-1/2 shrink-0 bg-[#1C1C1C] overflow-hidden flex flex-col'
      : 'mx-auto shrink-0 bg-[#1C1C1C] overflow-hidden flex flex-col'

  const chassisStyle = !kiosk
    ? undefined
    : fitMode === 'fit'
      ? { width: CONSOLE_WIDTH, transform: `translate(-50%, -50%) scale(${scale})` }
      : { width: CONSOLE_WIDTH }

  return (
    <div
      className={
        kiosk
          ? 'fixed inset-x-0 top-0 z-30 flex h-[100dvh] flex-col overflow-hidden bg-bg select-none text-text'
          : 'flex flex-col min-h-[calc(100vh-var(--header-h,64px))] bg-bg select-none text-text'
      }
    >
      {/* Kiosk chrome. The site header is hidden here (see `Header`), so the console
          carries its own slim bar: the zoom toggle, because a fitted console is small
          to tap, and a way back into the database without unloading the decks. A bar
          rather than floating buttons — every corner of the console is a control. */}
      {kiosk && (
        <div
          className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#141414] px-2 py-1"
          style={{
            paddingTop: 'max(0.25rem, env(safe-area-inset-top))',
            paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',
            paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
          }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open KeyBPM menu"
              className="flex h-8 w-8 shrink-0 touch-manipulation items-center justify-center rounded-md border border-white/15 bg-white/5 text-white/70 transition-colors active:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
              Mix it!
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
          {fullscreen.supported && (
            <button
              type="button"
              onClick={fullscreen.toggle}
              aria-label={fullscreen.active ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen (hides the address bar)'}
              className="flex h-8 w-8 shrink-0 touch-manipulation items-center justify-center rounded-md border border-white/15 bg-white/5 text-white/70 transition-colors active:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {fullscreen.active ? (
                  <path d="M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5" />
                ) : (
                  <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" />
                )}
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => setFitChoice(fitMode === 'fit' ? 'actual' : 'fit')}
            aria-label={
              fitMode === 'fit' ? 'Show the console at full size' : 'Fit the whole console on screen'
            }
            title={fitMode === 'fit' ? 'Fit to screen (tap for 1:1)' : 'Full size (tap to fit)'}
            className="flex h-8 shrink-0 touch-manipulation items-center justify-center rounded-md border border-white/15 bg-white/5 px-3 font-mono text-[11px] font-semibold text-white/70 transition-colors active:text-white"
          >
            {fitMode === 'fit' ? '1:1' : 'FIT'}
          </button>
          </div>
        </div>
      )}

      {/* Main DJ Console Workspace - Compact hardware layout matching real DJ controllers */}
      <main
        className={
          kiosk
            ? 'flex-1 flex flex-col min-h-0 w-full'
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
            Drop two tracks onto the decks, lock the keys, and start mixing live.
          </p>
        </div>
        )}

        {/* Safari: the console's audio paths are not supported there (see `isSafari`). */}
        <BrowserNotice className={kiosk ? 'mx-1 mt-1 shrink-0' : 'mt-3'} />

        {/* Error notification banner if any */}
        {errorMsg && (
          <div
            className={`${
              kiosk ? 'absolute inset-x-2 top-10 z-30' : 'mt-4'
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

            {/* 2. OPTIONAL FX DRAWER */}
            {activeFxDeck && (
              <TraktorFxDrawer
                deck={activeFxDeck === 'A' ? deckA : deckB}
                deckId={activeFxDeck}
                accentColor={activeFxDeck === 'A' ? '#34d399' : '#a855f7'}
                onClose={() => setActiveFxDeck(null)}
              />
            )}

            {/* 3. FULL-WIDTH STACKED SCROLLING WAVEFORMS. In a fitted console the lane
                gives up height on purpose: scaling a 290 px waveform to half size spends
                that space on the waveform while shrinking every fader to nothing, and the
                lane is the one block whose job survives being smaller. */}
            <div
              className={`w-full ${
                kiosk && fitMode === 'fit' ? 'h-[130px]' : 'h-[290px]'
              } border-b border-[#282828] bg-[#161616]`}
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
            <div className="grid grid-cols-[1fr_auto_1fr] items-stretch justify-center h-[280px] px-3 py-2 bg-[#1C1C1C] gap-4">
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

              {/* Central 5-Column Traktor Mixer matching mockup */}
              <div className="flex items-stretch h-full w-[380px] justify-center">
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
            <TraktorTransportBar engine={engine} />
          </div>
        </div>
      </main>

      {/* Menu sheet. Sits above the console so the decks stay mounted (and playing)
          while the user looks something up. */}
      {kiosk && (
        <>
          {menuOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="KeyBPM menu"
              className="fixed inset-0 z-50 flex flex-col bg-bg/95 p-4 backdrop-blur-sm"
              style={{
                paddingTop: 'max(1rem, env(safe-area-inset-top))',
                paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold tracking-wide">
                  Key<span className="text-accent">BPM</span>
                </span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg-card text-text-muted"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <nav aria-label="Primary" className="mt-3">
                <ul className="flex flex-col gap-0.5">
                  {KIOSK_LINKS.map(link => (
                    <li key={link.to}>
                      <Link
                        to={link.to}
                        onClick={() => setMenuOpen(false)}
                        className="flex min-h-12 items-center rounded-lg px-3 text-[15px] text-text transition-colors hover:bg-bg-hover active:bg-bg-hover"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <p className="mt-auto pt-4 text-[11px] leading-relaxed text-text-dim">
                The decks keep their tracks and keep playing while you browse. Come back here
                to mix.
              </p>
            </div>
          )}
        </>
      )}

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
              Turn your screen
            </p>
            <p className="mx-auto max-w-[17rem] text-sm leading-relaxed text-text-muted">
              The two-deck console needs landscape. Rotate your phone for the optimal view.
            </p>
          </div>
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
