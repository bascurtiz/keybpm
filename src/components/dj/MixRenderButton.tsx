import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/dj/audio-engine'
import { isTimelineEmpty } from '@/lib/dj/mix-timeline'
import type { MixRenderProgress, MixStretchEngine } from '@/lib/dj/mix-renderer'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

/**
 * Records the performance and renders it to a WAV file.
 *
 * Two distinct steps on purpose. Capture only writes down what the decks did, so
 * it costs nothing and never risks the audio thread; the render then rebuilds
 * that performance offline, where keylock segments are stretched again by an
 * engine that would never fit realtime playback. The UI stays truthful about
 * which step is happening, because the render is the slow one, and about which
 * stretcher produced the file, because Rubber Band and SoundTouch do not sound
 * the same.
 */
export function MixRenderButton({ engine }: { engine: AudioEngine }) {
  const [, setVer] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [stretchEngine, setStretchEngine] = useState<MixStretchEngine>('auto')
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    const unsubscribe = engine.subscribe(() => setVer(v => v + 1))
    return () => {
      unsubscribe()
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [engine])

  const recording = engine.recording

  useEffect(() => {
    if (!recording) return
    setElapsed(engine.recordingSeconds)
    const id = window.setInterval(() => setElapsed(engine.recordingSeconds), 250)
    return () => window.clearInterval(id)
  }, [recording, engine])

  const progress = engine.renderProgress
  const renders = busy || progress !== null
  const mix = engine.lastMix
  const youtubeDecks = (['A', 'B'] as const).filter(id => youtubeBridge.state[id].hasVideo)

  const start = () => {
    setError(null)
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    engine.startRecording()
  }

  const render = async () => {
    const timeline = engine.stopRecording()
    if (!timeline) {
      setError('Nothing was captured.')
      return
    }
    if (isTimelineEmpty(timeline)) {
      setError('No deck played while recording, so there is nothing to render.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await engine.renderRecording(timeline, { stretchEngine })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Render failed.')
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    const rendered = engine.lastMix
    if (!rendered) return
    if (!urlRef.current) urlRef.current = URL.createObjectURL(rendered.blob)
    const link = document.createElement('a')
    link.href = urlRef.current
    link.download = `keybpm-mix-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`
    link.click()
  }

  return (
    <div className="w-[104px] shrink-0 flex flex-col items-center justify-center gap-0.5 pl-2 border-l border-[#282828]">
      <span className="text-[7.5px] font-semibold text-[#888888] uppercase tracking-wider">
        MIX RENDER
      </span>

      {renders ? (
        <div
          className="w-full h-5 flex flex-col items-center justify-center rounded border border-[#333333] bg-[#141414]"
          role="progressbar"
          aria-valuenow={Math.round(overallPercent(progress))}
          aria-valuemin={0}
          aria-valuemax={100}
          title="Rendering offline: keylocked sections are time-stretched again at higher quality"
        >
          <span className="text-[8.5px] font-mono font-bold text-[#d4d4d4] tabular-nums leading-none">
            {Math.round(overallPercent(progress))}% {phaseLabel(progress)}
          </span>
          <div className="w-full h-[2px] bg-[#242424] rounded-full overflow-hidden mt-[2px] mx-1">
            <div
              className="h-full bg-emerald-400 transition-[width] duration-150"
              style={{ width: `${Math.round(overallPercent(progress))}%` }}
            />
          </div>
        </div>
      ) : recording ? (
        <button
          type="button"
          onClick={() => void render()}
          className="w-full h-5 rounded border border-red-500/70 bg-red-500/15 text-red-300 hover:text-white hover:bg-red-500/25 text-[9px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors animate-pulse"
          title="Stop capturing and render the mix offline"
        >
          <span className="w-1.5 h-1.5 rounded-[1px] bg-red-400" />
          RENDER
          <span className="font-mono tabular-nums">{formatClock(elapsed)}</span>
        </button>
      ) : (
        // Capture stays available after a render, and the last mix stays
        // downloadable alongside it: one performance is rarely the only one.
        <div className="w-full h-5 flex items-stretch gap-1">
          <button
            type="button"
            onClick={start}
            className={`flex-1 min-w-0 rounded border text-[9px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 ${
              youtubeDecks.length > 0
                ? 'border-[#333333] bg-[#141414] text-[#888888] hover:text-[#d4d4d4] hover:border-[#555555]'
                : 'border-[#333333] bg-[#141414] text-[#d4d4d4] hover:text-white hover:border-red-500/60'
            }`}
            title="Capture this performance, then render it to a WAV file"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            REC
          </button>
          {mix && (
            <button
              type="button"
              onClick={save}
              className="shrink-0 px-1.5 rounded border border-emerald-500/60 bg-emerald-500/10 text-emerald-300 hover:text-white hover:bg-emerald-500/20 text-[9px] font-bold uppercase tracking-wider transition-colors"
              title={`Save the last render: ${formatClock(mix.duration)} of ${mix.bitDepth}-bit ${(mix.sampleRate / 1000).toFixed(1)} kHz WAV`}
            >
              SAVE
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setStretchEngine(nextEngine(stretchEngine))}
        className="text-[7.5px] text-[#666666] hover:text-[#d4d4d4] leading-none text-center transition-colors"
        title={`Stretch engine: ${engineLabel(stretchEngine)}. Click to switch between auto, Rubber Band R3 and SoundTouch.`}
      >
        {summary(engine, error, mix, youtubeDecks.length > 0)}
      </button>
    </div>
  )
}

function phaseLabel(progress: MixRenderProgress | null): string {
  if (!progress) return 'RENDERING'
  if (progress.phase === 'measuring') return 'PLAN'
  if (progress.phase === 'mixing') return 'MIX'
  if (progress.phase === 'encoding') return 'WRITE'
  if (progress.phase === 'done') return 'DONE'
  return 'STRETCH'
}

/** Single percentage across both phases, since the phases have different costs. */
function overallPercent(progress: MixRenderProgress | null): number {
  if (!progress) return 4
  switch (progress.phase) {
    case 'measuring':
      return 3
    case 'stretching': {
      const count = progress.segmentCount ?? 1
      const done = (progress.segment ?? 1) - 1 + (progress.ratio ?? 0)
      return 3 + (done / count) * 86
    }
    case 'mixing':
      return 92
    case 'encoding':
      return 97
    default:
      return 100
  }
}

function summary(
  engine: AudioEngine,
  error: string | null,
  mix: {
    duration: number
    stretchedSegments: number
    directSegments: number
    stretchEngine: 'rubberband' | 'soundtouch'
  } | null,
  hasYoutube: boolean
): string {
  if (error) return error
  if (engine.renderProgress) return 'offline'
  if (engine.recording) return 'capturing'
  if (mix) {
    const stretched = mix.stretchedSegments > 0 ? ` · ${mix.stretchedSegments}st` : ''
    const engineUsed = mix.stretchEngine === 'rubberband' ? 'RB' : 'ST'
    return `${formatClock(mix.duration)}${stretched} · ${engineUsed}`
  }
  if (hasYoutube) return 'no YT audio'
  return 'rec + render'
}

function engineLabel(engine: MixStretchEngine): string {
  if (engine === 'rubberband') return 'Rubber Band R3 only'
  if (engine === 'soundtouch') return 'SoundTouch only'
  return 'auto (Rubber Band, falling back to SoundTouch)'
}

function nextEngine(engine: MixStretchEngine): MixStretchEngine {
  if (engine === 'auto') return 'rubberband'
  if (engine === 'rubberband') return 'soundtouch'
  return 'auto'
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}
