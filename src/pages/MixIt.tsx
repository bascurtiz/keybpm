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
import {
  KEY_LOCK_ENGINE_INFO,
  readKeyLockEngine,
  writeKeyLockEngine,
} from '@/lib/dj/keyLockEnginePref'
import type { KeyLockEngine } from '@/lib/dj/keylock-transform'
// import { YouTubeVideoOverlay } from '@/components/dj/YouTubeVideoOverlay'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [, setEngineVer] = useState(0)

  // Per-deck load generation so a finishing older analysis can't clear a newer one.
  const loadGenRef = useRef({ A: 0, B: 0 })
  const settingsRef = useRef<HTMLDivElement>(null)

  // Close the settings panel on a click outside it, or on Escape.
  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [settingsOpen])

  // Apply the stored keylock-engine preference. Rubber Band's voices only exist once the
  // worklets are up, so this re-runs when they appear rather than giving up on the first pass
  // — and `rubberBandAvailable` is a getter, so the dependency is its value, not its identity.
  useEffect(() => {
    const want = readKeyLockEngine()
    if (engine.keyLockEngine === want) return
    if (want === 'rubberband' && !engine.rubberBandAvailable) return
    engine.setKeyLockEngine(want)
  }, [engine, engine.keyLockEngine, engine.rubberBandAvailable])

  const selectKeyLockEngine = (id: KeyLockEngine) => {
    writeKeyLockEngine(id)
    engine.setKeyLockEngine(id)
  }

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

  return (
    <div className="flex flex-col min-h-[calc(100vh-var(--header-h,64px))] bg-bg select-none text-text">
      {/* Main DJ Console Workspace - Compact hardware layout matching real DJ controllers */}
      <main className="flex-1 flex flex-col max-w-[1160px] w-full mx-auto px-4 py-6">
        {/* Page Title Row */}
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
          <div className="flex items-center gap-3">
            <p className="text-xs text-text-muted text-right">
              Drop two tracks onto the decks, lock the keys, and start mixing live.
            </p>

            {/* Settings */}
            <div className="relative" ref={settingsRef}>
              <button
                type="button"
                onClick={() => setSettingsOpen(o => !o)}
                title="Settings"
                aria-label="Settings"
                aria-expanded={settingsOpen}
                aria-haspopup="dialog"
                className={`w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
                  settingsOpen
                    ? 'bg-white/10 text-text border-white/25'
                    : 'bg-white/5 text-text-muted border-white/10 hover:text-text hover:border-white/25'
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>

              {settingsOpen && (
                <div
                  role="dialog"
                  aria-label="Settings"
                  className="absolute right-0 top-9 z-40 w-[22rem] p-3 rounded-lg bg-[#181818]/95 border border-[#333333] shadow-xl backdrop-blur-md text-left"
                >
                  <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-text-muted">
                    Keylock engine
                  </div>
                  <div className="mt-1 text-[11px] leading-snug text-text-muted">
                    Holds the pitch while a deck is pitched. Both decks switch together, and it
                    takes effect immediately — even mid-mix.
                  </div>

                  <div className="mt-2.5 flex flex-col gap-1.5">
                    {(['soundtouch', 'rubberband'] as const).map(id => {
                      const info = KEY_LOCK_ENGINE_INFO[id]
                      const active = engine.keyLockEngine === id
                      const unavailable = id === 'rubberband' && !engine.rubberBandAvailable
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={unavailable}
                          onClick={() => selectKeyLockEngine(id)}
                          className={`text-left rounded-md border px-2.5 py-2 transition-colors ${
                            unavailable
                              ? 'border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed'
                              : active
                                ? 'border-accent/50 bg-accent/10'
                                : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-text">{info.label}</span>
                            {active && !unavailable && (
                              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-accent">
                                Active
                              </span>
                            )}
                            {unavailable && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                                Loading…
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                            {info.tagline}
                          </div>
                          <div className="mt-1 text-[11px] leading-snug text-text-muted">
                            {info.detail}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-white/10 text-[11px] leading-snug text-text-muted">
                    Switching while a deck plays is safe — it stays on the old engine until the
                    new one is producing audio, so there is never a gap in the music.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error notification banner if any */}
        {errorMsg && (
          <div className="mt-4 p-2.5 rounded-lg bg-bad/10 border border-bad/30 text-bad text-xs flex items-center justify-between">
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

        {/* Single Seamless Traktor DJ Hardware Chassis */}
        <div className="mt-4 w-full overflow-x-auto pb-2 flex justify-center">
          <div className="w-[1120px] max-w-full bg-[#1C1C1C] rounded-xl border border-[#282828] shadow-2xl overflow-hidden flex flex-col shrink-0">
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

            {/* 3. FULL-WIDTH STACKED SCROLLING WAVEFORMS */}
            <div className="w-full h-[290px] border-b border-[#282828] bg-[#161616]">
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

      {/* Load Track / YouTube Video Modal */}
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
        onLoadYouTube={deckId => {
          // YouTube replaces any local Web Audio track on this deck.
          if (deckId === 'A') deckA.ejectTrack()
          else deckB.ejectTrack()
        }}
      />
    </div>
  )
}
