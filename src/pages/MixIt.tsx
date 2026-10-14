import { useEffect, useRef, useState } from 'react'
import { getAudioEngine } from '@/lib/dj/audio-engine'
import { analyzeTrackFile, type AnalyzeProgress } from '@/lib/dj/track-analyzer'
import { consumePendingDeckTrackA } from '@/lib/dj/trackTransfer'
import { StackedWaveforms } from '@/components/dj/StackedWaveforms'
import { TraktorMiddleStrip } from '@/components/dj/TraktorMiddleStrip'
import { TraktorDeck } from '@/components/dj/TraktorDeck'
import { TraktorMixer } from '@/components/dj/TraktorMixer'
import { TraktorTransportBar } from '@/components/dj/TraktorTransportBar'
import { TraktorFxDrawer } from '@/components/dj/TraktorFxDrawer'
import { LoadTrackModal } from '@/components/dj/LoadTrackModal'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

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

  const fileInputARef = useRef<HTMLInputElement>(null)
  const fileInputBRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.title = 'Mix it! — KeyBPM DJ Player'
    if (typeof window !== 'undefined') {
      ;(window as any).__KEYBPM_ENGINE__ = engine
    }
  }, [engine])

  // Auto-load track passed from KeyTagger / Auto-detect
  useEffect(() => {
    const pending = consumePendingDeckTrackA()
    if (pending) {
      if (pending.file) {
        void handleFileSelected('A', pending.file)
      } else if (pending.buffer) {
        const track = {
          id: `transferred-${Date.now()}`,
          title: pending.metadata?.title || 'Loaded Track',
          artist: pending.metadata?.artist || 'Unknown Artist',
          genre: pending.metadata?.genre,
          label: pending.metadata?.label,
          duration: pending.buffer.duration,
          bpm: pending.bpm || pending.metadata?.bpm || 128,
          grid: {
            bpm: pending.bpm || pending.metadata?.bpm || 128,
            firstBeat: 0,
            firstBar: 0,
            beatsPerBar: 4,
          },
          key:
            pending.keyInfo ||
            (pending.metadata?.camelot
              ? { name: pending.metadata.key || '', camelot: pending.metadata.camelot }
              : null),
          gain: 1,
          buffer: pending.buffer,
          coverUrl: pending.metadata?.coverUrl,
          peaks: new Float32Array(2400),
        }
        deckA.loadTrack(track)
      }
    }
  }, [deckA])

  const handleFileSelected = async (targetDeckId: 'A' | 'B', file: File) => {
    setAnalyzingDeck(targetDeckId)
    setErrorMsg(null)
    setAnalysisProgress({
      stage: 'decoding',
      progress: 0.05,
      message: `Analyzing track for Deck ${targetDeckId}…`,
    })

    try {
      await engine.resume()
      const analyzedTrack = await analyzeTrackFile(file, p => {
        setAnalysisProgress(p)
      })

      if (targetDeckId === 'A') {
        deckA.loadTrack(analyzedTrack)
      } else {
        deckB.loadTrack(analyzedTrack)
      }
    } catch (err: unknown) {
      console.error('Error analyzing DJ track:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(`Failed to analyze track: ${msg}`)
    } finally {
      setAnalyzingDeck(null)
      setAnalysisProgress(null)
    }
  }

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

  return (
    <div className="flex flex-col min-h-[calc(100vh-var(--header-h,64px))] bg-bg select-none text-text">
      {/* Hidden File Inputs */}
      <input
        ref={fileInputARef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff"
        onChange={e => {
          if (e.target.files && e.target.files[0]) {
            void handleFileSelected('A', e.target.files[0])
          }
        }}
        className="hidden"
      />
      <input
        ref={fileInputBRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff"
        onChange={e => {
          if (e.target.files && e.target.files[0]) {
            void handleFileSelected('B', e.target.files[0])
          }
        }}
        className="hidden"
      />

      {/* Main DJ Console Workspace - Compact hardware layout matching real DJ controllers */}
      <main className="flex-1 flex flex-col max-w-[1160px] w-full mx-auto px-4 py-6">
        {/* Page Title Row */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white tracking-wide">Mix it!</h1>
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
              Beta
            </span>
          </div>
          <p className="text-xs text-text-muted text-right">
            Drop two tracks onto the decks, lock the keys, and start mixing live.
          </p>
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
                style={{ borderColor: analyzingDeck === 'A' ? '#34d399' : '#a855f7' }}
              />
              <span>Loading Deck {analyzingDeck}</span>
            </div>
            <p className="text-xs text-text-muted">{analysisProgress.message}</p>
            <div className="mx-auto h-2 w-full overflow-hidden rounded-full bg-[#222222]">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${Math.round(analysisProgress.progress * 100)}%`,
                  backgroundColor: analyzingDeck === 'A' ? '#34d399' : '#a855f7',
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
            ? deckB.track?.bpm ?? youtubeBridge.state.B.bpm
            : deckA.track?.bpm ?? youtubeBridge.state.A.bpm
        }
        otherDeckCamelot={
          loadModalDeck === 'A'
            ? deckB.track?.key?.camelot ?? youtubeBridge.state.B.camelot
            : deckA.track?.key?.camelot ?? youtubeBridge.state.A.camelot
        }
        onClose={() => setLoadModalDeck(null)}
        onLoadLocalFile={handleFileSelected}
      />
    </div>
  )
}
