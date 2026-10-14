import { useState, useMemo } from 'react'
import { tracks, useCatalog } from '@/lib/data'
import { youtubeId, youtubeThumbUrl } from '@/lib/youtube'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'
import { camelotColor, areKeysCompatible } from '@/lib/camelot'
import { shortKey } from '@/lib/format'
import { CAMELOT_TO_KEY } from '@/types/track'
import type { Track } from '@/types/track'

interface LoadTrackModalProps {
  isOpen: boolean
  deckId: 'A' | 'B'
  otherDeckBpm?: number
  otherDeckCamelot?: string | null
  onClose: () => void
  onLoadLocalFile: (deckId: 'A' | 'B', file: File) => void
  /** Called after a YouTube video is successfully queued so the parent can eject local audio. */
  onLoadYouTube?: (deckId: 'A' | 'B') => void
}

type TabType = 'youtube' | 'catalog' | 'file'

export function LoadTrackModal({
  isOpen,
  deckId,
  otherDeckBpm: _otherDeckBpm,
  otherDeckCamelot,
  onClose,
  onLoadLocalFile,
  onLoadYouTube,
}: LoadTrackModalProps) {
  useCatalog()
  const [activeTab, setActiveTab] = useState<TabType>('file')
  const [ytUrl, setYtUrl] = useState('')
  const [customTitle, setCustomTitle] = useState('')
  const [customBpm, setCustomBpm] = useState('128')
  const [customCamelot, setCustomCamelot] = useState('8A')
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

  const handleLoadYouTube = async () => {
    if (!detectedVideoId) return
    const bpmNum = parseFloat(customBpm) || 128
    const ok = await youtubeBridge.loadVideo(deckId, detectedVideoId, {
      title: customTitle.trim() || `YouTube Track (${detectedVideoId})`,
      bpm: bpmNum,
      camelot: customCamelot,
      key: CAMELOT_TO_KEY[customCamelot] || undefined,
    })
    if (ok) onLoadYouTube?.(deckId)
    onClose()
  }

  const handleSelectCatalogTrack = async (track: Track) => {
    if (track.youtube) {
      const vid = youtubeId(track.youtube)
      if (vid) {
        const ok = await youtubeBridge.loadVideo(deckId, vid, {
          title: `${track.artist} - ${track.title}`,
          artist: track.artist,
          bpm: track.bpm || 128,
          camelot: track.camelot || undefined,
          key: track.key || undefined,
          duration: track.duration || 0,
        })
        if (ok) onLoadYouTube?.(deckId)
        onClose()
        return
      }
    }

    // If no direct YouTube link, switch to YouTube tab with track metadata pre-filled
    setActiveTab('youtube')
    setCustomTitle(`${track.artist} - ${track.title}`)
    if (track.bpm) setCustomBpm(track.bpm.toString())
    if (track.camelot) setCustomCamelot(track.camelot)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none">
      <div className="relative w-full max-w-2xl bg-[#181818] rounded-xl border border-[#2c2c2c] shadow-2xl flex flex-col overflow-hidden text-white max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#141414] border-b border-[#252525]">
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
            className="text-zinc-400 hover:text-white p-1 rounded transition text-base leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-5 pt-3 border-b border-[#252525] gap-2 bg-[#161616]">
          <button
            type="button"
            onClick={() => setActiveTab('file')}
            className={`pb-2.5 px-3 text-xs font-semibold transition border-b-2 flex items-center gap-1.5 ${
              activeTab === 'file'
                ? 'border-emerald-400 text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>📁</span> Local Audio File
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('youtube')}
            className={`pb-2.5 px-3 text-xs font-semibold transition border-b-2 flex items-center gap-1.5 ${
              activeTab === 'youtube'
                ? 'border-red-500 text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>▶</span> YouTube
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`pb-2.5 px-3 text-xs font-semibold transition border-b-2 flex items-center gap-1.5 ${
              activeTab === 'catalog'
                ? 'border-accent text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Catalog
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-5 flex-1 overflow-y-auto">
          {/* 1. YOUTUBE TAB */}
          {activeTab === 'youtube' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  YouTube Video URL or Video ID:
                </label>
                <input
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=... or youtu.be/..."
                  value={ytUrl}
                  onChange={e => setYtUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#222] border border-[#333] text-sm text-white focus:outline-none focus:border-red-500 font-mono transition"
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
                    <p className="text-xs text-white font-semibold truncate">
                      {customTitle || `YouTube ID: ${detectedVideoId}`}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-[#1c1c1c] border border-dashed border-[#2a2a2a] text-center text-zinc-500 text-xs">
                  Paste any YouTube music video, set, or remix to mix live with DJ controller faders.
                </div>
              )}

              {/* Title & Metadata inputs */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1">
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                    Track Title (optional):
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Bicep - Glue"
                    value={customTitle}
                    onChange={e => setCustomTitle(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#222] border border-[#333] text-xs text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                    BPM:
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={customBpm}
                    onChange={e => setCustomBpm(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#222] border border-[#333] text-xs text-white focus:outline-none focus:border-zinc-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                    Camelot Key:
                  </label>
                  <select
                    value={customCamelot}
                    onChange={e => setCustomCamelot(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#222] border border-[#333] text-xs text-white focus:outline-none focus:border-zinc-500 font-mono"
                  >
                    {[
                      '1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
                      '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B',
                    ].map(k => (
                      <option key={k} value={k}>
                        {k} ({CAMELOT_TO_KEY[k] ? shortKey(CAMELOT_TO_KEY[k]) : ''})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Popular DJ presets */}
              <div className="mt-1">
                <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block mb-1.5">
                  Or load a demo electronic music track:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { title: '100 gecs - geccraft', url: 'https://www.youtube.com/watch?v=JMab0ub1Ds4', bpm: 84.5, cam: '8A' },
                    { title: '2 Mello - BREAK DOWN BREAK UP', url: 'https://www.youtube.com/watch?v=XbaMLd7cJeM', bpm: 144, cam: '8A' },
                    { title: 'Alien Ant Farm - Smooth Criminal', url: 'https://www.youtube.com/watch?v=CDl9ZMfj6aE', bpm: 126, cam: '8A' },
                    { title: 'Fisher - Losing It', url: 'https://www.youtube.com/watch?v=vV_f8p_d34U', bpm: 125, cam: '11A' },
                  ].map(demo => (
                    <button
                      key={demo.title}
                      type="button"
                      onClick={() => {
                        setYtUrl(demo.url)
                        setCustomTitle(demo.title)
                        setCustomBpm(demo.bpm.toString())
                        setCustomCamelot(demo.cam)
                      }}
                      className="px-2.5 py-1 rounded bg-[#222] hover:bg-[#2c2c2c] text-[11px] text-zinc-300 border border-[#333] transition"
                    >
                      {demo.title} ({demo.bpm} BPM / {demo.cam})
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-[#252525] hover:bg-[#303030] text-xs font-semibold text-zinc-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!detectedVideoId}
                  onClick={handleLoadYouTube}
                  className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:hover:bg-red-600 text-xs font-bold text-white shadow-lg transition flex items-center gap-1.5"
                >
                  <span>▶</span> Load into Deck {deckId}
                </button>
              </div>
            </div>
          )}

          {/* 2. KEYDB CATALOG TAB */}
          {activeTab === 'catalog' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Search catalog by title, artist, genre, BPM..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-[#222] border border-[#333] text-xs text-white focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => setFilterOnlyVideo(!filterOnlyVideo)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-semibold border transition flex items-center gap-1 shrink-0 ${
                    filterOnlyVideo
                      ? 'bg-red-500/20 border-red-500/50 text-red-400'
                      : 'bg-[#222] border-[#333] text-zinc-400 hover:text-white'
                  }`}
                  title="Filter tracks with YouTube video links"
                >
                  <span className="text-red-400">▶</span> Video Only
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

              <div className="max-h-[300px] overflow-y-auto rounded-lg border border-[#282828] divide-y divide-[#242424]">
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
                          onClick={() => handleSelectCatalogTrack(t)}
                          className="px-2.5 py-1 rounded bg-[#2e2e2e] hover:bg-accent hover:text-black text-[11px] font-semibold text-zinc-200 transition flex items-center gap-1"
                        >
                          {t.youtube ? '▶ Load' : 'Load'}
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
            <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[#333] hover:border-emerald-400/60 rounded-xl bg-[#1c1c1c] transition">
              <span className="text-3xl mb-2">📁</span>
              <p className="text-sm font-semibold text-white mb-1">
                Choose an audio file from your computer
              </p>
              <p className="text-xs text-zinc-400 mb-4 text-center max-w-sm">
                Supports MP3, WAV, FLAC, AAC, OGG. Decodes with full Web Audio waveform peaks, 3-band EQ, and vinyl scratching.
              </p>
              <label className="cursor-pointer px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg transition">
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
          )}
        </div>
      </div>
    </div>
  )
}
