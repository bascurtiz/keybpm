import { useState, useMemo } from 'react'
import { tracks, useCatalog } from '@/lib/data'
import { youtubeId, youtubeThumbUrl } from '@/lib/youtube'
import { camelotColor, areKeysCompatible } from '@/lib/camelot'
import { DOWNLOADER_PRIMARY, DOWNLOADER_FALLBACKS, copyText } from '@/lib/downloader'
import type { Track } from '@/types/track'

interface LoadTrackModalProps {
  isOpen: boolean
  deckId: 'A' | 'B'
  otherDeckBpm?: number
  otherDeckCamelot?: string | null
  onClose: () => void
  onLoadLocalFile: (deckId: 'A' | 'B', file: File) => void
}

type TabType = 'download' | 'catalog' | 'file'

/**
 * Load a track onto a deck.
 *
 * There are three ways in, and they all end at the same place: a decoded
 * `AudioBuffer` handed to `analyzeTrackFile`. That is deliberate. The deck
 * needs samples in this process to build a beat grid, a waveform and a keylock
 * stage, and only a file the user actually has can provide them.
 *
 * The "From YouTube" tab is therefore not a player. It is a two-step errand:
 * get the link into an external downloader, then drop the resulting file back
 * in. The old YouTube IFrame path could not do any of this — its audio lives on
 * another origin, so it could never be analysed, keylocked or scratched.
 */
export function LoadTrackModal({
  isOpen,
  deckId,
  otherDeckBpm: _otherDeckBpm,
  otherDeckCamelot,
  onClose,
  onLoadLocalFile,
}: LoadTrackModalProps) {
  useCatalog()
  const [activeTab, setActiveTab] = useState<TabType>('file')
  const [ytUrl, setYtUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCompatible, setFilterCompatible] = useState(false)
  const [filterOnlyVideo, setFilterOnlyVideo] = useState(true)

  const detectedVideoId = useMemo(() => youtubeId(ytUrl), [ytUrl])

  // Filter KeyDB tracks
  const catalogTracks = useMemo(() => {
    let list = tracks
    if (filterOnlyVideo) {
      list = list.filter(t => Boolean(t.youtube))
    }
    if (filterCompatible && otherDeckCamelot) {
      list = list.filter(t => t.camelot && areKeysCompatible(otherDeckCamelot, t.camelot))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        t =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          (t.camelot && t.camelot.toLowerCase().includes(q)) ||
          (t.bpm && t.bpm.toString().includes(q)) ||
          (t.genre && t.genre.toLowerCase().includes(q))
      )
    }
    return list.slice(0, 60)
  }, [searchQuery, filterCompatible, filterOnlyVideo, otherDeckCamelot])

  if (!isOpen) return null

  const accentColor = deckId === 'A' ? '#34d399' : '#a855f7'

  const handleCopyLink = async () => {
    const ok = await copyText(ytUrl.trim())
    setCopied(ok)
  }

  /** Take the file the user just downloaded and send it down the local-file path. */
  const handleDownloadedFile = (file: File | undefined) => {
    if (!file) return
    onLoadLocalFile(deckId, file)
    onClose()
  }

  /**
   * A catalog row is metadata only — the dataset carries no audio. So the
   * useful thing a row can do is hand over the video link and switch the user
   * to the tab where they can act on it.
   */
  const handleSelectCatalogTrack = (track: Track) => {
    if (!track.youtube) return
    setYtUrl(track.youtube)
    setCopied(false)
    setActiveTab('download')
    void copyText(track.youtube).then(ok => setCopied(ok))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm select-none sm:p-4">
      {/* `dvh`, not `vh`: on a phone the address bar is exactly that difference, and a
          dialog sized against `vh` hangs off the bottom in landscape. */}
      <div className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[#2c2c2c] bg-[#181818] text-white shadow-2xl sm:max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#252525] bg-[#141414] px-3 py-2 sm:px-5 sm:py-3.5 [@media(max-height:520px)]:py-1.5">
          <div className="flex items-center gap-2.5">
            <span
              className="text-xs font-mono font-bold px-2 py-0.5 rounded border"
              style={{
                color: accentColor,
                backgroundColor: `${accentColor}15`,
                borderColor: `${accentColor}40`,
              }}
            >
              DECK {deckId}
            </span>
            <h2 className="text-sm font-bold text-white tracking-wide">Load Audio Track</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base leading-none text-zinc-400 transition hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation. Scrolls sideways rather than squeezing three labels into a
            360 px phone, where the third tab used to be clipped by the dialog. */}
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#252525] bg-[#161616] px-2 pt-2 sm:gap-2 sm:px-5 sm:pt-3 [@media(max-height:520px)]:pt-1">
          <button
            type="button"
            onClick={() => setActiveTab('file')}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2 text-xs font-semibold transition sm:px-3 sm:pb-2.5 [@media(max-height:520px)]:pb-1 ${
              activeTab === 'file'
                ? 'border-emerald-400 text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>📁</span>
            <span className="hidden sm:inline">Local Audio File</span>
            <span className="sm:hidden">Local file</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('download')}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2 text-xs font-semibold transition sm:px-3 sm:pb-2.5 [@media(max-height:520px)]:pb-1 ${
              activeTab === 'download'
                ? 'border-accent text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>⬇</span>
            <span className="hidden sm:inline">From YouTube</span>
            <span className="sm:hidden">YouTube</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2 text-xs font-semibold transition sm:px-3 sm:pb-2.5 [@media(max-height:520px)]:pb-1 ${
              activeTab === 'catalog'
                ? 'border-accent text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Catalog
          </button>
        </div>

        {/* Tab Body. Each tab owns its scrolling instead of the body scrolling as a
            whole: the catalog's list then fills a landscape phone's ~230 px of
            leftover height, rather than nesting a 300 px scroll area inside a
            scrolled parent that is shorter than it. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 1. FROM YOUTUBE TAB */}
          {activeTab === 'download' && (
            <div className="flex flex-col gap-4 overflow-y-auto overscroll-contain p-3 sm:p-5">
              <p className="text-xs text-zinc-400 leading-relaxed">
                KeyBPM downloads nothing — it has no server and hands out no audio. Fetch the file
                with an external tool, then drop it below. You get a beat grid, key and keylock,
                exactly like a local file.
              </p>

              {/* Step 1 — get the link out */}
              <div>
                <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider block mb-1.5">
                  Step 1 — the link
                </span>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  YouTube Video URL or Video ID:
                </label>
                <input
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=... or youtu.be/..."
                  value={ytUrl}
                  onChange={e => {
                    setYtUrl(e.target.value)
                    setCopied(false)
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[#222] border border-[#333] text-sm text-white focus:outline-none focus:border-accent font-mono transition"
                />
              </div>

              {/* Video Preview */}
              {detectedVideoId ? (
                <div className="flex gap-4 p-3 rounded-lg bg-[#202020] border border-[#2e2e2e] items-center">
                  <img
                    src={youtubeThumbUrl(detectedVideoId)}
                    alt="Thumbnail preview"
                    className="w-28 h-16 object-cover rounded shadow"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] text-red-400 font-mono font-bold uppercase tracking-wider block">
                      Video Detected
                    </span>
                    <p className="text-xs text-white font-semibold truncate font-mono">
                      {detectedVideoId}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-[#1c1c1c] border border-dashed border-[#2a2a2a] text-center text-zinc-500 text-xs">
                  Paste a YouTube link, copy it, then fetch the file with one of the tools below.
                </div>
              )}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={!detectedVideoId}
                  onClick={handleCopyLink}
                  className="self-start px-3 py-2 rounded-lg bg-[#252525] hover:bg-[#303030] disabled:opacity-40 disabled:hover:bg-[#252525] text-xs font-semibold text-zinc-200 transition"
                >
                  {copied ? '✓ Link copied' : '📋 Copy link'}
                </button>

                {/*
                  One obvious action, then quiet fallbacks. Each link stages the URL
                  on the clipboard before it navigates, so the user's next move inside
                  the tool is a paste. The anchor does the navigating — calling
                  window.open here too would open two tabs.
                */}
                <a
                  href={DOWNLOADER_PRIMARY.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (detectedVideoId) void handleCopyLink()
                  }}
                  className="flex flex-col gap-0.5 px-4 py-2.5 rounded-lg bg-accent-solid hover:brightness-110 shadow-lg transition"
                >
                  <span className="text-sm font-bold">⬇ Open {DOWNLOADER_PRIMARY.name}</span>
                  <span className="text-[11px] leading-snug opacity-75">
                    {DOWNLOADER_PRIMARY.note}
                  </span>
                </a>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                    If that doesn&apos;t work
                  </span>
                  {DOWNLOADER_FALLBACKS.map(opt => (
                    <a
                      key={opt.name}
                      href={opt.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        if (detectedVideoId) void handleCopyLink()
                      }}
                      className="flex flex-col gap-0.5 px-3 py-1.5 rounded-lg bg-[#1c1c1c] border border-[#282828] hover:border-accent/40 hover:bg-[#222] transition"
                    >
                      <span className="text-[11px] font-semibold text-zinc-300">↗ {opt.name}</span>
                      <span className="text-[10px] leading-snug text-zinc-500">{opt.note}</span>
                    </a>
                  ))}
                </div>
              </div>

              {/* Step 2 — bring the file back */}
              <div>
                <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider block mb-1.5">
                  Step 2 — the file
                </span>
                <div
                  onDragOver={e => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setDragOver(false)
                    handleDownloadedFile(e.dataTransfer.files?.[0])
                  }}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 transition sm:p-6 ${
                    dragOver
                      ? 'border-accent bg-accent/5'
                      : 'border-[#333] bg-[#1c1c1c] hover:border-accent/60'
                  }`}
                >
                  <span className="text-2xl mb-2">⬇</span>
                  <p className="text-xs font-semibold text-white mb-1">
                    Drop the downloaded audio file here
                  </p>
                  <p className="text-[11px] text-zinc-400 mb-3 text-center max-w-xs">
                    MP3, M4A, WAV, FLAC, OGG or OPUS — anything the browser can decode.
                  </p>
                  <label className="cursor-pointer px-4 py-2 rounded-lg bg-[#2e2e2e] hover:bg-emerald-600 text-white font-bold text-xs transition">
                    Browse File
                    <input
                      type="file"
                      accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.webm"
                      onChange={e => handleDownloadedFile(e.target.files?.[0])}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-[#252525] hover:bg-[#303030] text-xs font-semibold text-zinc-300 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* 2. KEYDB CATALOG TAB */}
          {activeTab === 'catalog' && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Search catalog by title, artist, genre, BPM..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="min-w-[11rem] flex-1 rounded-lg border border-[#333] bg-[#222] px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setFilterOnlyVideo(!filterOnlyVideo)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-semibold border transition flex items-center gap-1 shrink-0 ${
                    filterOnlyVideo
                      ? 'bg-red-500/20 border-red-500/50 text-red-400'
                      : 'bg-[#222] border-[#333] text-zinc-400 hover:text-white'
                  }`}
                  title="Filter tracks that have a YouTube link to hand to the downloader"
                >
                  <span className="text-red-400">▶</span> Has Video
                </button>
                {otherDeckCamelot && (
                  <button
                    type="button"
                    onClick={() => setFilterCompatible(!filterCompatible)}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold border transition shrink-0 ${
                      filterCompatible
                        ? 'bg-accent/20 border-accent text-accent'
                        : 'bg-[#222] border-[#333] text-zinc-400 hover:text-white'
                    }`}
                  >
                    Harmonic Match ({otherDeckCamelot})
                  </button>
                )}
              </div>

              {/* Fills what the dialog has left on a phone, and stops at 340 px on a
                  tall screen so the modal keeps its compact desktop size. */}
              <div className="max-h-[min(340px,65dvh)] min-h-0 flex-1 divide-y divide-[#242424] overflow-y-auto overscroll-contain rounded-lg border border-[#282828]">
                {catalogTracks.map(t => {
                  const camColor = t.camelot ? camelotColor(t.camelot) : '#777'
                  const isHarmonic =
                    otherDeckCamelot && t.camelot && areKeysCompatible(otherDeckCamelot, t.camelot)

                  return (
                    <div
                      key={t.id}
                      className="p-2.5 flex items-center justify-between hover:bg-[#222] transition gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {t.camelot && (
                          <span
                            className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
                            style={{
                              backgroundColor: `${camColor}25`,
                              color: camColor,
                              border: `1px solid ${camColor}50`,
                            }}
                          >
                            {t.camelot}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                            <span className="truncate">{t.title}</span>
                            {t.youtube && (
                              <span className="text-[9px] font-bold text-red-400 bg-red-950/50 border border-red-500/30 px-1 py-0.2 rounded shrink-0">
                                ▶ VIDEO
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-zinc-400 truncate">
                            {t.artist} {t.bpm ? `• ${t.bpm} BPM` : ''} {t.genre ? `• ${t.genre}` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isHarmonic && (
                          <span className="text-[9px] font-bold text-accent bg-accent/10 border border-accent/30 px-1.5 py-0.5 rounded">
                            MIXABLE
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={!t.youtube}
                          onClick={() => handleSelectCatalogTrack(t)}
                          title={
                            t.youtube
                              ? "Copy this track's link and switch to the download tab"
                              : 'No video link on this record'
                          }
                          className="px-2.5 py-1 rounded bg-[#2e2e2e] hover:bg-emerald-600 disabled:opacity-30 disabled:hover:bg-[#2e2e2e] text-[11px] font-semibold text-zinc-200 disabled:text-zinc-500 transition flex items-center gap-1"
                        >
                          {t.youtube ? '⬇ Get file' : 'No link'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 3. LOCAL FILE TAB */}
          {activeTab === 'file' && (
            <div className="flex flex-1 overflow-y-auto overscroll-contain rounded-xl border-2 border-dashed border-[#333] bg-[#1c1c1c] p-4 transition hover:border-emerald-400/60 sm:p-8">
              {/* `m-auto`, not `justify-center`: on a short landscape screen the block is
                  taller than the room left for it, and flex centring would clip the top
                  of it out of reach. Auto margins collapse to 0 and keep it scrollable. */}
              <div className="m-auto flex flex-col items-center text-center">
              <span className="mb-2 text-3xl">📁</span>
              <p className="mb-1 text-sm font-semibold text-white">
                Choose an audio file from your computer
              </p>
              <p className="mb-4 max-w-sm text-center text-xs text-zinc-400">
                Supports MP3, WAV, FLAC, AAC, OGG. Decodes with full Web Audio waveform peaks, 3-band EQ, and vinyl scratching.
              </p>
              <label className="cursor-pointer rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition hover:bg-emerald-500">
                Browse Audio File
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff"
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      onLoadLocalFile(deckId, e.target.files[0])
                      onClose()
                    }
                  }}
                  className="hidden"
                />
              </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
