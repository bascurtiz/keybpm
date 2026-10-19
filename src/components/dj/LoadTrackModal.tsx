import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { tracks, useCatalog } from '@/lib/data'
import { youtubeId, youtubeThumbUrl } from '@/lib/youtube'
import { camelotColor, areKeysCompatible } from '@/lib/camelot'
import { DOWNLOADER_PRIMARY, copyText } from '@/lib/downloader'
import { YoutubeIcon } from '@/components/icons'
import type { PrecomputedTrackData } from '@/lib/dj/track-analyzer'
import { CAMELOT_TO_KEY, type Track } from '@/types/track'

interface LoadTrackModalProps {
  isOpen: boolean
  deckId: 'A' | 'B'
  otherDeckBpm?: number
  otherDeckCamelot?: string | null
  onClose: () => void
  /**
   * Hand a file to the deck. `precomputed` is what the *source* already knows about the
   * recording — see `pendingYouTube` — and outranks anything the file's own tags say.
   */
  onLoadLocalFile: (deckId: 'A' | 'B', file: File, precomputed?: PrecomputedTrackData) => void
}

type TabType = 'download' | 'catalog' | 'file'

/**
 * What the file picker accepts. One list for every way in: the local tab and the YouTube tab
 * both end in the same decoder, so a format one of them offers and the other hides would be an
 * accident of history rather than a limit of the app.
 */
const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.webm'

/**
 * The one way this dialog asks for a file.
 *
 * "From YouTube — step 2" and "Local Audio File" are the same act at the end: hand the dialog
 * a file, which it decodes into a beat grid, a key and a keylock stage. They used to be two
 * separately written drop zones — different radius, border, icon size, button weight and
 * padding — which made the everyday path look like the lesser one. They are this card now, so
 * they cannot drift apart again.
 *
 * `fill` stretches the card over the tab's whole body, for the local tab where it is the only
 * thing on screen instead of one step in a list.
 *
 * The mark is the one thing the two callers don't share: a folder where the file is already on
 * this machine, a download arrow where it still has to be fetched. Everything else about the
 * card — size, border, type, button — is common, which is what makes them read as one control.
 */
function AudioDropCard({
  id,
  icon = '⬇',
  heading,
  hint,
  fill = false,
  onFile,
}: {
  /** Labels the card for screen readers; the picker inside is its real control. */
  id: string
  /** The mark above the heading; says where the file comes from. */
  icon?: string
  heading: string
  hint: string
  fill?: boolean
  onFile: (file: File | undefined) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      onDragOver={e => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        onFile(e.dataTransfer.files?.[0])
      }}
      aria-labelledby={id}
      className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-3 text-center transition sm:p-4 ${
        fill ? 'min-h-[7.5rem] flex-1' : ''
      } ${dragOver ? 'border-accent bg-accent/5' : 'border-[#333] bg-[#1c1c1c] hover:border-accent/60'}`}
    >
      <span className="mb-1.5 text-xl" aria-hidden="true">
        {icon}
      </span>
      <p id={id} className="mb-1 text-xs font-semibold text-white">
        {heading}
      </p>
      <p className="mb-2.5 max-w-md text-[11px] text-zinc-400">{hint}</p>
      <label className="cursor-pointer rounded-lg bg-[#2e2e2e] px-4 py-2 text-xs font-bold text-white transition hover:bg-accent hover:text-[#04201a]">
        Browse File
        <input
          type="file"
          accept={AUDIO_ACCEPT}
          onChange={e => onFile(e.target.files?.[0])}
          className="hidden"
        />
      </label>
    </div>
  )
}

/**
 * The heading of one step in the From YouTube tab: a bare number, an imperative title, and an
 * optional right-hand aside carrying that step's state ("link detected", "opens in a new tab").
 *
 * Not a badge in a circle and not a card of its own: the sequence is carried by the number and
 * the reading order, and two more containers would compete with the drop card that has to be a
 * real target.
 */
function StepHeading({
  n,
  title,
  aside,
  asideClass,
}: {
  n: string
  title: string
  aside?: string
  /** The aside is grey unless a step wants to say it is ready. */
  asideClass?: string
}) {
  return (
    <div className="mb-1.5 flex items-baseline gap-1.5">
      <span aria-hidden="true" className="font-mono text-[10px] font-bold leading-none text-zinc-600">
        {n}
      </span>
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">{title}</h3>
      {aside ? (
        <span
          className={`ml-auto shrink-0 text-[10px] leading-none ${asideClass ?? 'text-zinc-600'}`}
        >
          {aside}
        </span>
      ) : null}
    </div>
  )
}

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
  /**
   * The catalog row the link in the box came from, if it came from one at all.
   *
   * Kept as the *row*, not as a copied bag of fields, so that editing the link can
   * invalidate it: the metadata is only true for the video it was taken from.
   */
  const [catalogTrack, setCatalogTrack] = useState<Track | null>(null)
  const [copied, setCopied] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCompatible, setFilterCompatible] = useState(false)

  /**
   * The From YouTube panel's own height, so the Catalog tab can match it.
   *
   * The two tabs are compared side by side, and the catalog used to stand ~40 px taller
   * than the errand. A fixed number cannot fix that: the errand's height changes when a
   * video is detected and the artwork row appears in step 3. So the errand is measured
   * while it is on screen and the catalog takes that height. The local tab is left out
   * on purpose — it is a single drop target and should keep filling the dialog.
   */
  const downloadPanelRef = useRef<HTMLDivElement>(null)
  const [downloadPanelHeight, setDownloadPanelHeight] = useState<number | null>(null)

  /**
   * Which deck the link in the box was prepared for.
   *
   * The component stays mounted while the dialog is shut, so the errand survives being
   * interrupted — you can close it, fetch the file, and come back. But a link prepared
   * for deck A must not be waiting when deck B is opened: dropping a file there would
   * stamp deck B with another track's title, BPM and key.
   */
  const openedForDeck = useRef<'A' | 'B' | null>(null)
  useEffect(() => {
    if (!isOpen) return
    if (openedForDeck.current === deckId) return
    openedForDeck.current = deckId
    setYtUrl('')
    setCatalogTrack(null)
    setCopied(false)
  }, [isOpen, deckId])

  const detectedVideoId = useMemo(() => youtubeId(ytUrl), [ytUrl])

  useLayoutEffect(() => {
    if (activeTab !== 'download') return
    const el = downloadPanelRef.current
    if (el) setDownloadPanelHeight(el.offsetHeight)
  }, [activeTab, detectedVideoId])

  /** The catalog row behind the link — null once the link points somewhere else. */
  const sourceTrack = useMemo(() => {
    if (!catalogTrack || !detectedVideoId) return null
    return youtubeId(catalogTrack.youtube) === detectedVideoId ? catalogTrack : null
  }, [catalogTrack, detectedVideoId])

  /**
   * What the video in the box will stamp onto the file dropped below.
   *
   * This is the whole difference between "From YouTube" and "Local Audio File": the
   * audio that arrives is a downloaded file either way, so without this the two tabs are
   * the same errand with an extra step. Everything here is known *before* the download
   * finishes, so the deck can open with the video's artwork, and — when the link came
   * from a catalog row — the catalogue's title, artist, BPM and key, rather than whatever
   * tags the downloader happened to write. Skipping key detection and the tempo search
   * for known values is also most of the load time.
   *
   * The artwork is unconditional: any link names a video, and its thumbnail is as true
   * an image of the recording as the deck is going to get.
   */
  const pendingYouTube = useMemo<PrecomputedTrackData | undefined>(() => {
    if (!detectedVideoId) return undefined
    const coverUrl = youtubeThumbUrl(detectedVideoId)
    if (!sourceTrack) return { metadata: { coverUrl } }

    const camelot = sourceTrack.camelot
    const key = camelot
      ? { name: sourceTrack.key || CAMELOT_TO_KEY[camelot] || camelot, camelot }
      : null

    return {
      bpm: sourceTrack.bpm ?? undefined,
      key,
      metadata: {
        title: sourceTrack.title,
        artist: sourceTrack.artist,
        genre: sourceTrack.genre ?? undefined,
        label: sourceTrack.label ?? undefined,
        coverUrl,
      },
    }
  }, [detectedVideoId, sourceTrack])

  /**
   * Filter KeyDB tracks.
   *
   * Every row here has a YouTube link, unconditionally: this tab exists to hand a link to a
   * downloader, and a row without one offers nothing the catalog page does not do better. The
   * filter that used to toggle that used to be a button, which asked the reader to work out
   * whether off was useful — it never was.
   */
  const catalogTracks = useMemo(() => {
    let list = tracks.filter(t => Boolean(t.youtube))
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
  }, [searchQuery, filterCompatible, otherDeckCamelot])

  if (!isOpen) return null

  const accentColor = deckId === 'A' ? '#34d399' : '#a855f7'

  /** The catalogue's facts about the video, in the deck's own order: artist, BPM, key, genre. */
  const youtubeStamp = [
    sourceTrack?.artist,
    sourceTrack?.bpm ? `${sourceTrack.bpm} BPM` : null,
    sourceTrack?.camelot,
    sourceTrack?.genre,
  ]
    .filter(Boolean)
    .join(' · ')

  const handleCopyLink = async () => {
    const ok = await copyText(ytUrl.trim())
    setCopied(ok)
  }

  /** A file from this machine: nothing is known about it but what its tags claim. */
  const handleLocalFile = (file: File | undefined) => {
    if (!file) return
    onLoadLocalFile(deckId, file)
    onClose()
  }

  /** The file the user just downloaded for the video in step 1. */
  const handleDownloadedFile = (file: File | undefined) => {
    if (!file) return
    onLoadLocalFile(deckId, file, pendingYouTube)
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
    setCatalogTrack(track)
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
                ? 'border-accent text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>📁</span>
            <span className="hidden sm:inline">Local Audio File</span>
            <span className="sm:hidden">Local file</span>
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
        </div>

        {/* Tab Body. Each tab owns its scrolling instead of the body scrolling as a
            whole: the catalog's list then fills a landscape phone's ~230 px of
            leftover height, rather than nesting a 300 px scroll area inside a
            scrolled parent that is shorter than it. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 1. FROM YOUTUBE TAB.
              An errand in three steps, so the tab is laid out in that order: paste, fetch,
              drop. Each step is one heading and one control, separated by hairlines rather
              than boxed — the tab bar is already a box, and a card inside a card reads as
              options rather than as a sequence.

              Type carries the hierarchy instead: step headings are 10 px uppercase, anything
              you can press has a fill or a border (Open AudioFetcher, Copy, Browse File), and
              every sentence of explanation sits at 10–11 px in zinc-500
              with no box around it. That is the whole difference between "press this" and
              "read this"; nothing in between. */}
          {activeTab === 'download' && (
            <div
              ref={downloadPanelRef}
              className="flex max-h-[62dvh] min-h-0 flex-col overflow-y-auto overscroll-contain"
            >
              {/* 1 — the link */}
              <section className="border-b border-[#242424] px-3 py-2 sm:px-4">
                <StepHeading
                  n="1"
                  title="Paste the video"
                  aside={detectedVideoId ? 'link detected' : 'link or ID'}
                  asideClass={detectedVideoId ? 'text-accent' : undefined}
                />
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    aria-label="YouTube video URL or video ID"
                    placeholder="youtube.com/watch?v=… or youtu.be/…"
                    value={ytUrl}
                    onChange={e => {
                      setYtUrl(e.target.value)
                      setCopied(false)
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-[#333] bg-[#222] px-2.5 py-1.5 font-mono text-xs text-white transition focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!detectedVideoId}
                    onClick={handleCopyLink}
                    className="shrink-0 rounded-lg bg-[#252525] px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition hover:bg-[#303030] disabled:opacity-40 disabled:hover:bg-[#252525]"
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                {detectedVideoId ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    {/* No thumbnail here: the artwork belongs to step 3, where it is shown
                        beside the title it will become. Two copies of the same frame an inch
                        apart only made the reader check whether they were the same video. */}
                    <span className="min-w-0 truncate font-mono text-[10px] text-zinc-400">
                      {detectedVideoId}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
                      copied when you open a tool
                    </span>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[10px] text-zinc-500">
                    A youtube.com or youtu.be link, or just the 11-character ID.
                  </p>
                )}
              </section>

              {/* 2 — the fetch. One button does the same two things every time: put the link
                  on the clipboard, then open the tool in a new tab. The anchor does the
                  navigating; calling window.open here as well would open two tabs. */}
              <section className="border-b border-[#242424] px-3 py-2 sm:px-4">
                <StepHeading n="2" title="Fetch the file" aside="opens in a new tab" />
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={DOWNLOADER_PRIMARY.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (detectedVideoId) void handleCopyLink()
                    }}
                    className="rounded-lg bg-[#2e2e2e] px-4 py-2 text-xs font-bold text-white transition hover:bg-accent hover:text-[#04201a]"
                  >
                    Open {DOWNLOADER_PRIMARY.name}
                  </a>
                  <span
                    className="min-w-0 truncate text-[11px] text-zinc-500"
                    title={DOWNLOADER_PRIMARY.note}
                  >
                    {DOWNLOADER_PRIMARY.note}
                  </span>
                </div>
              </section>

              {/* 3 — the file. The only control here that loads anything. */}
              <section className="px-3 py-2 sm:px-4">
                <StepHeading
                  n="3"
                  title="Drop it back in"
                  aside={sourceTrack ? 'catalog values' : pendingYouTube ? 'video artwork' : 'after the download finishes'}
                  asideClass={sourceTrack ? 'text-accent' : undefined}
                />

                {/* What the drop will be labelled. Shown *before* the download finishes so
                    the tab answers its own question — drop the file here and the deck opens
                    with this, rather than with whatever the file calls itself. */}
                {detectedVideoId && pendingYouTube && (
                  <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#1d1d1d] px-2 py-1.5">
                    <img
                      src={youtubeThumbUrl(detectedVideoId)}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-[3px] object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold leading-tight text-zinc-200">
                        {sourceTrack ? sourceTrack.title : 'Video artwork as cover'}
                      </p>
                      <p className="truncate font-mono text-[10px] leading-tight text-zinc-500">
                        {youtubeStamp || 'title and key from the audio'}
                      </p>
                    </div>
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-zinc-600">
                      on load
                    </span>
                  </div>
                )}

                <AudioDropCard
                  id="youtube-drop-heading"
                  heading="Drop the downloaded file here"
                  hint="MP3, M4A, WAV, FLAC, OGG or OPUS — anything the browser can decode."
                  onFile={handleDownloadedFile}
                />
              </section>
            </div>
          )}

          {/* 2. KEYDB CATALOG TAB. Sized to the From YouTube panel — measured, since that
              panel's height depends on whether a video is already in the box. The class is
              only the fallback for opening this tab before the errand has been visited. */}
          {activeTab === 'catalog' && (
            <div
              style={downloadPanelHeight ? { height: downloadPanelHeight } : undefined}
              className="flex h-[345px] max-h-[62dvh] min-h-0 flex-col gap-3 p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Search catalog by title, artist, genre, BPM..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="min-w-[11rem] flex-1 rounded-lg border border-[#333] bg-[#222] px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                />
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

              {/* Fills the body height the tabs share, so the list ends where the
                  YouTube tab's last step does rather than setting its own cap. */}
              <div className="min-h-0 flex-1 divide-y divide-[#242424] overflow-y-auto overscroll-contain rounded-lg border border-[#282828]">
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
                              <span
                                role="img"
                                aria-label="Has a YouTube link"
                                title="Has a YouTube link"
                                className="shrink-0 leading-none"
                              >
                                <YoutubeIcon size={12} className="text-[#FF0033]" />
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
                          className="px-2.5 py-1 rounded bg-[#2e2e2e] hover:bg-accent hover:text-[#04201a] disabled:opacity-30 disabled:hover:bg-[#2e2e2e] text-[11px] font-semibold text-zinc-200 disabled:text-zinc-500 transition flex items-center gap-1"
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

          {/* 3. LOCAL FILE TAB. The same card as the YouTube tab's step 2 — one file, dropped
              in or picked — filling the tab's body because it is all this tab does. */}
          {activeTab === 'file' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-3 sm:p-5">
              <AudioDropCard
                id="local-file-heading"
                icon="📁"
                fill
                heading="Drop an audio file here"
                hint="MP3, M4A, WAV, FLAC, OGG or OPUS — anything the browser can decode."
                onFile={handleLocalFile}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
