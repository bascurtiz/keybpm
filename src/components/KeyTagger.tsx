import { useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { detectAudioKey, type KeyDetectionResult, type DetectKeyProgress } from '@/lib/keyDetector'
import { normalizeBpmConfidence } from '@/lib/bpmDetector'
import { extractAudioMetadata, type AudioMetadata } from '@/lib/audioMetadata'
import { camelotColor, camelotTint, camelotToOpenKey, getCompatibleKeys } from '@/lib/camelot'
import { CAMELOT_TO_KEY } from '@/types/track'
import { shortKey } from '@/lib/format'
import { readWheelMode, writeWheelMode, type WheelMode } from '@/lib/wheelMode'

interface KeyTaggerProps {
  onSelectKey?: (camelot: string) => void
  onSelectBpm?: (bpm: number) => void
  onClose?: () => void
  compact?: boolean
  className?: string
}

export function KeyTagger({ onSelectKey, onSelectBpm, onClose, className = '' }: KeyTaggerProps) {
  const [file, setFile] = useState<File | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [progress, setProgress] = useState<DetectKeyProgress | null>(null)
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null)
  const [result, setResult] = useState<KeyDetectionResult | null>(null)
  const [showResultModal, setShowResultModal] = useState(false)
  const [bpmMultiplier, setBpmMultiplier] = useState<number>(1)
  const [wheelMode, setWheelMode] = useState<WheelMode>(() => {
    const m = readWheelMode()
    return m === 'openkey' ? 'openkey' : 'camelot'
  })
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const toggleNotation = () => {
    const next: WheelMode = wheelMode === 'openkey' ? 'camelot' : 'openkey'
    setWheelMode(next)
    writeWheelMode(next)
  }

  const processFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    setDetecting(true)
    setError(null)
    setMetadata(null)
    setResult(null)
    setBpmMultiplier(1)
    setShowResultModal(false)
    setProgress({ stage: 'decoding', progress: 0.05, message: 'Loading audio file…' })

    try {
      const [meta, res] = await Promise.all([
        extractAudioMetadata(selectedFile),
        detectAudioKey(selectedFile, {
          onProgress: p => setProgress(p),
        }),
      ])
      setMetadata(meta)
      setResult(res)
      setShowResultModal(true)
      if (meta.hasTags || selectedFile) {
        sessionStorage.setItem(
          'keybpm_custom_origin',
          JSON.stringify({
            camelot: res.camelot,
            bpm: res.bpm,
            key: res.key,
            artist: meta.artist,
            title: meta.title || selectedFile.name.replace(/\.[a-zA-Z0-9]+$/, ''),
            fileName: selectedFile.name,
            coverUrl: meta.coverUrl,
          }),
        )
      }
      if (onSelectKey) {
        onSelectKey(res.camelot)
      }
      if (onSelectBpm && res.bpm) {
        onSelectBpm(res.bpm)
      }
    } catch (err: unknown) {
      console.error('Key detection failed:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || 'Failed to detect key from audio file.')
    } finally {
      setDetecting(false)
      setProgress(null)
    }
  }, [onSelectKey, onSelectBpm])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      void processFile(files[0])
    }
  }, [processFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      void processFile(files[0])
    }
  }, [processFile])

  const reset = useCallback(() => {
    setFile(null)
    setMetadata(null)
    setResult(null)
    setBpmMultiplier(1)
    setShowResultModal(false)
    setError(null)
    setProgress(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const effectiveBpm = result?.bpm ? Math.round(result.bpm * bpmMultiplier * 10) / 10 : undefined
  const bpmConfidencePct = result?.bpmConfidence !== undefined
    ? Math.min(100, Math.max(0, (result.bpmConfidence > 1 ? normalizeBpmConfidence(result.bpmConfidence) : result.bpmConfidence) * 100))
    : undefined

  return (
    <>
      <div className={`surface rounded-xl border border-line p-4 lg:pt-3 transition-all ${className}`}>
        <div className="kt-header-row mb-3.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold">Auto-detect</h2>
            <div className="group relative inline-flex items-center">
              <span
                tabIndex={0}
                aria-label="Nothing beats human ears, but as 2nd opinion, you could use this. 100% private in-browser, no audio leaves your device. Results won't be published in the database."
                className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line bg-bg-card font-mono text-[10px] font-bold text-text-dim hover:border-text-muted hover:text-text focus:outline-none focus:ring-1 focus:ring-accent"
              >
                ?
              </span>
              <div
                role="tooltip"
                className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 hidden w-72 rounded-md border border-line bg-bg-card p-2 text-xs font-normal leading-relaxed text-text shadow-xl group-hover:block group-focus-within:block"
              >
                <p className="text-text">Nothing beats human ears, but as a 2nd opinion, you could use this.</p>
                <p className="mt-1 text-text-muted">100% private in-browser, no audio leaves your device.</p>
                <p className="mt-1 text-text-muted">Results won't be published in the database.</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {result && (
              <button
                type="button"
                onClick={() => setShowResultModal(true)}
                className="group flex flex-col items-center text-xs font-semibold leading-tight"
              >
                <span className="text-accent group-hover:underline">View result</span>
                <span className="flex items-center gap-1 font-mono font-bold no-underline">
                  <span style={{ color: camelotColor(result.camelot) }}>{result.camelot}</span>
                  {effectiveBpm && (
                    <span className="text-[11px] font-normal text-text-muted">· {effectiveBpm}</span>
                  )}
                </span>
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-line bg-bg text-xs leading-none text-text-muted hover:text-text"
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <p className="mb-3 text-xs text-text-muted">
          Powered by a fine-tuned MusicalKeyCNN & Essentia WASM
        </p>

        {/* Upload Zone */}
        {!detecting && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            isDragOver
              ? 'border-accent bg-accent/10'
              : 'border-line hover:border-line-hover hover:bg-bg-hover'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff"
            onChange={handleFileChange}
            className="hidden"
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mb-2 text-text-dim"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div className="text-xs font-medium text-text">
            <div>Drop an audio track here,</div>
            <div className="mt-0.5 whitespace-nowrap">
              or <span className="text-accent underline">browse</span>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-text-dim">
            MP3, WAV, FLAC, M4A, AAC, OGG
          </p>
        </div>
      )}

      {/* Progress State */}
      {detecting && (
        <div className="space-y-3 py-4 text-center">
          <div className="flex items-center justify-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span className="text-xs font-medium text-text">
              {progress?.message || 'Analyzing audio key…'}
            </span>
          </div>
          {file && (
            <p className="truncate text-[11px] text-text-dim">
              File: {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
            </p>
          )}
          <div className="mx-auto h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${Math.round((progress?.progress ?? 0.1) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          <p className="font-medium">Error analyzing file:</p>
          <p className="mt-0.5">{error}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-2 text-[11px] text-red-300 underline hover:text-white"
          >
            Try another file
          </button>
        </div>
      )}

      </div>

      {/* Result Modal Popup */}
      {showResultModal && result && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowResultModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Key Detection Result"
        >
          <div
            className="relative w-full max-w-lg overflow-hidden rounded-xl border border-line bg-bg-card p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {metadata?.coverUrl ? (
                  <img
                    src={metadata.coverUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-lg object-cover border border-line"
                  />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {metadata?.hasTags && (metadata.title || metadata.artist) ? (
                    <>
                      <h3 className="truncate text-sm font-semibold leading-tight">
                        {metadata.title || 'Detection Result'}
                      </h3>
                      {metadata.artist ? (
                        <p className="truncate text-xs text-text-dim">
                          {metadata.artist}
                        </p>
                      ) : file ? (
                        <p className="truncate text-xs text-text-dim" title={file.name}>
                          {file.name}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <h3 className="text-sm font-semibold">Detection Result</h3>
                      {file && (
                        <p className="truncate text-xs text-text-dim" title={file.name}>
                          {file.name}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleNotation}
                  className="rounded-md border border-line bg-bg px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:border-line-hover hover:text-text"
                  title="Toggle Camelot / Open Key notation"
                >
                  {wheelMode === 'openkey' ? 'Open Key' : 'Camelot'}
                </button>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-bg text-sm leading-none text-text-muted hover:text-text"
                  onClick={() => setShowResultModal(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-lg border border-line bg-bg p-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line/60 gap-4 sm:gap-0">
                  {/* Musical Key */}
                  <div className="flex items-center gap-3 sm:pr-4">
                    <div
                      className="flex h-14 min-w-[3.5rem] px-2 shrink-0 items-center justify-center rounded-xl font-mono text-2xl font-bold shadow-sm"
                      style={{
                        backgroundColor: camelotTint(result.camelot, 0.2),
                        color: camelotColor(result.camelot),
                        border: `1px solid ${camelotColor(result.camelot)}`,
                      }}
                    >
                      {wheelMode === 'openkey' ? (camelotToOpenKey(result.camelot) ?? result.camelot) : result.camelot}
                    </div>
                    <div>
                      <div className="text-lg font-bold text-text">
                        {shortKey(result.key)}
                        <span className="ml-1.5 text-xs font-normal text-text-dim">({result.key})</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                        <span>Confidence:</span>
                        <strong className="font-mono font-semibold text-text">
                          {(result.confidence * 100).toFixed(1)}%
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* BPM Section */}
                  {effectiveBpm !== undefined && (
                    <div className="flex items-center justify-between pt-3 sm:pt-0 sm:pl-5">
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-2xl font-bold text-text">{effectiveBpm.toFixed(1)}</span>
                          <span className="text-xs font-bold text-text-dim">BPM</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                          <span>Confidence:</span>
                          {bpmConfidencePct !== undefined && (
                            <strong className="font-mono font-semibold text-text">
                              {bpmConfidencePct.toFixed(1)}%
                            </strong>
                          )}
                        </div>
                      </div>

                      {/* Half/Double toggle (stacked: ×2 on top, /2 below, equal width & right-aligned) */}
                      <div className="flex flex-col gap-1 ml-auto shrink-0">
                        <button
                          type="button"
                          onClick={() => setBpmMultiplier(m => (m === 2 ? 1 : 2))}
                          className={`flex h-5 w-7 items-center justify-center rounded border font-mono text-xs leading-none transition-colors ${
                            bpmMultiplier === 2
                              ? 'border-accent bg-accent/20 text-accent font-bold'
                              : 'border-line bg-bg-card text-text-muted hover:border-line-hover hover:text-text'
                          }`}
                          title="Double tempo (×2)"
                          aria-label="Double tempo"
                        >
                          <span className="inline-block w-2.5 text-center">×</span>
                          <span>2</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setBpmMultiplier(m => (m === 0.5 ? 1 : 0.5))}
                          className={`flex h-5 w-7 items-center justify-center rounded border font-mono text-xs leading-none transition-colors ${
                            bpmMultiplier === 0.5
                              ? 'border-accent bg-accent/20 text-accent font-bold'
                              : 'border-line bg-bg-card text-text-muted hover:border-line-hover hover:text-text'
                          }`}
                          title="Halve tempo (/2)"
                          aria-label="Halve tempo"
                        >
                          <span className="inline-block w-2.5 text-center text-[8px] opacity-70">/</span>
                          <span>2</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Compatible Keys Row & Actions */}
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 text-xs font-medium text-text-muted">
                    Harmonically compatible keys:
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {getCompatibleKeys(result.camelot).map(code => {
                      const kName = CAMELOT_TO_KEY[code] || code
                      const isSelected = code === result.camelot
                      const displayCode = wheelMode === 'openkey' ? (camelotToOpenKey(code) ?? code) : code
                      return (
                        <Link
                          key={code}
                          to={`/browse?camelot=${code}`}
                          className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:border-accent ${
                            isSelected
                              ? 'border-accent bg-accent/15 text-accent font-semibold'
                              : 'border-line bg-bg text-text-muted'
                          }`}
                          style={
                            isSelected
                              ? { borderColor: camelotColor(code), color: camelotColor(code) }
                              : undefined
                          }
                        >
                          <span className="font-mono font-bold">{displayCode}</span>
                          <span className="text-[10px] text-text-dim">({shortKey(kName)})</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <Link
                    to={effectiveBpm ? `/browse?camelot=${result.camelot}&bpm=${Math.round(effectiveBpm)}` : `/browse?camelot=${result.camelot}`}
                    className="btn-ghost w-28 justify-center py-1 text-xs text-center"
                  >
                    Browse {wheelMode === 'openkey' ? (camelotToOpenKey(result.camelot) ?? result.camelot) : result.camelot}
                  </Link>
                  <Link
                    to={{
                      pathname: effectiveBpm
                        ? `/mix/${result.camelot}/${Math.round(effectiveBpm)}`
                        : `/mix/${result.camelot}`,
                      search:
                        metadata?.hasTags && (metadata.artist || metadata.title)
                          ? `?artist=${encodeURIComponent(metadata.artist || '')}&title=${encodeURIComponent(metadata.title || '')}`
                          : file
                            ? `?file=${encodeURIComponent(file.name.replace(/\.[a-zA-Z0-9]+$/, ''))}`
                            : undefined,
                    }}
                    state={{
                      customTrack: {
                        artist: metadata?.artist,
                        title: metadata?.title || (file ? file.name.replace(/\.[a-zA-Z0-9]+$/, '') : undefined),
                        fileName: file?.name,
                        coverUrl: metadata?.coverUrl,
                        bpm: effectiveBpm,
                        key: result.key,
                        camelot: result.camelot,
                      },
                    }}
                    onClick={() => {
                      if (metadata || result || file) {
                        sessionStorage.setItem(
                          'keybpm_custom_origin',
                          JSON.stringify({
                            camelot: result.camelot,
                            bpm: effectiveBpm,
                            key: result.key,
                            artist: metadata?.artist,
                            title: metadata?.title || (file ? file.name.replace(/\.[a-zA-Z0-9]+$/, '') : undefined),
                            fileName: file?.name,
                            coverUrl: metadata?.coverUrl,
                          }),
                        )
                      }
                    }}
                    className="btn-primary w-28 justify-center py-1 text-xs text-center"
                  >
                    Find mixes
                  </Link>
                </div>
              </div>

              {/* Top Candidates Alternative Logits (limited to top 3) */}
              {result.topCandidates.length > 1 && (
                <div>
                  <div className="mb-2.5 text-xs font-medium text-text-muted">
                    Confidence ranking:
                  </div>
                  <div className="space-y-1">
                    {result.topCandidates.slice(0, 3).map(cand => {
                      const displayCode = wheelMode === 'openkey' ? (camelotToOpenKey(cand.camelot) ?? cand.camelot) : cand.camelot
                      return (
                        <div
                          key={cand.camelot}
                          className="flex items-center justify-between rounded border border-line/60 bg-bg/50 px-2.5 py-1 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="font-mono font-semibold"
                              style={{ color: camelotColor(cand.camelot) }}
                            >
                              {displayCode}
                            </span>
                            <span className="text-text-muted">{shortKey(cand.key)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                              <div
                                className="h-full bg-accent"
                                style={{ width: `${Math.round(cand.confidence * 100)}%` }}
                              />
                            </div>
                            <span className="w-12 text-right font-mono text-[11px] text-text-dim">
                              {(cand.confidence * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
