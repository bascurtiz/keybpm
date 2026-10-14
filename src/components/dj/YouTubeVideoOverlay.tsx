import { useEffect, useState, useRef } from 'react'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'

interface YouTubeVideoOverlayProps {
  crossfade: number // -1 (A) .. 1 (B)
  onEjectDeck?: (deckId: 'A' | 'B') => void
  onOpenLoadModal?: (deckId: 'A' | 'B') => void
}

export function YouTubeVideoOverlay({
  crossfade,
  onEjectDeck,
  onOpenLoadModal,
}: YouTubeVideoOverlayProps) {
  const [deckState, setDeckState] = useState(youtubeBridge.state)
  const [displayMode, setDisplayMode] = useState<'split' | 'vj-blend'>('split')
  const [isMinimized, setIsMinimized] = useState(false)

  const refA = useRef<HTMLDivElement>(null)
  const refB = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    const unsub = youtubeBridge.subscribe(() => {
      setDeckState({
        A: { ...youtubeBridge.state.A },
        B: { ...youtubeBridge.state.B },
      })
    })

    if (!mountedRef.current) {
      mountedRef.current = true
      if (refA.current) void youtubeBridge.mountPlayer('A', refA.current)
      if (refB.current) void youtubeBridge.mountPlayer('B', refB.current)
    }

    return () => {
      unsub()
    }
  }, [])

  // Synchronize crossfader volume
  useEffect(() => {
    youtubeBridge.syncCrossfade(crossfade)
  }, [crossfade])

  const hasAnyVideo = deckState.A.hasVideo || deckState.B.hasVideo

  // Opacity calculation for VJ Blend mode (-1 = full A, 0 = 50/50, 1 = full B)
  const normCrossfade = (crossfade + 1) / 2 // 0 .. 1
  const opacityB = normCrossfade
  const opacityA = 1 - normCrossfade

  return (
    <div className="w-full bg-[#121212] border-b border-[#282828] select-none transition-all duration-200">
      {/* VJ Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181818] border-b border-[#242424] text-[11px]">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-2 w-2 rounded-full ${
              hasAnyVideo ? 'bg-red-500 animate-pulse' : 'bg-zinc-600'
            }`}
          />
          <span className="font-bold uppercase tracking-wider text-white">YouTube VJ Decks</span>
          <span className="text-[10px] text-zinc-400 font-mono">
            {deckState.A.hasVideo && deckState.B.hasVideo
              ? 'Dual Video Sync'
              : deckState.A.hasVideo || deckState.B.hasVideo
              ? 'Single Deck Video'
              : 'Standby'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasAnyVideo && (
            <div className="flex bg-[#0f0f0f] rounded p-0.5 border border-[#2a2a2a]">
              <button
                type="button"
                onClick={() => setDisplayMode('split')}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                  displayMode === 'split' ? 'bg-[#2a2a2a] text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Split View
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('vj-blend')}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                  displayMode === 'vj-blend' ? 'bg-[#2a2a2a] text-accent' : 'text-zinc-400 hover:text-white'
                }`}
              >
                VJ Blend
              </button>
            </div>
          )}

          {!hasAnyVideo && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenLoadModal?.('A')}
                className="px-2 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono transition"
              >
                + Deck A Video
              </button>
              <button
                type="button"
                onClick={() => onOpenLoadModal?.('B')}
                className="px-2 py-0.5 rounded bg-purple-950/60 hover:bg-purple-900 border border-purple-500/40 text-purple-300 text-[10px] font-mono transition"
              >
                + Deck B Video
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="px-2 py-0.5 rounded bg-[#222] hover:bg-[#2e2e2e] text-zinc-300 text-[10px] font-mono border border-[#333]"
          >
            {isMinimized ? 'Expand Screens' : 'Collapse'}
          </button>
        </div>
      </div>

      {/* Video Screens Viewport Container - ALWAYS in DOM to preserve YouTube Iframes */}
      <div
        className={`relative w-full bg-black overflow-hidden transition-all duration-300 ${
          isMinimized ? 'h-0' : hasAnyVideo ? 'h-[220px]' : 'h-[96px]'
        }`}
      >
        {/* ================= DECK A VIDEO CONTAINER ================= */}
        <div
          className={`overflow-hidden transition-all duration-200 ${
            displayMode === 'split'
              ? 'absolute top-0 bottom-0 left-0 w-1/2'
              : 'absolute inset-0 w-full h-full'
          }`}
          style={{
            opacity: displayMode === 'vj-blend' ? opacityA : 1,
            zIndex: displayMode === 'vj-blend' && opacityA > opacityB ? 2 : 1,
          }}
        >
          {/* Host div mounted by YouTubeBridge */}
          <div ref={refA} className="w-full h-full" />

          {/* Empty state placeholder when no video is loaded on Deck A */}
          {!deckState.A.hasVideo && (
            <div
              onClick={() => onOpenLoadModal?.('A')}
              className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 text-xs gap-1 bg-[#0a0a0a]/90 hover:bg-[#121212] cursor-pointer transition"
            >
              <span className="font-bold text-emerald-400">Deck A: No Video</span>
              <span className="text-[10px] text-zinc-400">Click to load YouTube video or KeyDB track</span>
            </div>
          )}

          {/* Deck A HUD Banner */}
          {deckState.A.hasVideo && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/80 px-2 py-0.5 rounded backdrop-blur-md border border-emerald-500/40 shadow-lg">
              <span className="text-[10px] font-bold text-emerald-400">DECK A</span>
              <span className="text-[10px] text-zinc-200 truncate max-w-[140px]">
                {deckState.A.title}
              </span>
              <button
                type="button"
                onClick={() => youtubeBridge.togglePlay('A')}
                className="ml-1 px-1.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-black text-[10px] font-bold transition"
                title={deckState.A.playing ? 'Pause' : 'Play'}
              >
                {deckState.A.playing ? '❚❚' : '▶'}
              </button>
              {onEjectDeck && (
                <button
                  type="button"
                  onClick={() => onEjectDeck('A')}
                  className="ml-0.5 text-[10px] text-zinc-400 hover:text-red-400 font-bold"
                  title="Eject video"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Deck A Warning Banner */}
          {deckState.A.errorMessage && (
            <div className="absolute inset-x-2 bottom-2 z-10 bg-red-950/90 border border-red-500/60 rounded px-2.5 py-1 text-[10px] text-red-200 flex items-center justify-between backdrop-blur-md">
              <span className="truncate">⚠️ {deckState.A.errorMessage}</span>
              <button
                type="button"
                onClick={() => onOpenLoadModal?.('A')}
                className="underline font-bold text-white ml-2 shrink-0 hover:text-red-300"
              >
                Change
              </button>
            </div>
          )}
        </div>

        {/* ================= DECK B VIDEO CONTAINER ================= */}
        <div
          className={`overflow-hidden transition-all duration-200 ${
            displayMode === 'split'
              ? 'absolute top-0 bottom-0 right-0 w-1/2 border-l border-[#282828]'
              : 'absolute inset-0 w-full h-full'
          }`}
          style={{
            opacity: displayMode === 'vj-blend' ? opacityB : 1,
            zIndex: displayMode === 'vj-blend' && opacityB >= opacityA ? 2 : 1,
          }}
        >
          {/* Host div mounted by YouTubeBridge */}
          <div ref={refB} className="w-full h-full" />

          {/* Empty state placeholder when no video is loaded on Deck B */}
          {!deckState.B.hasVideo && (
            <div
              onClick={() => onOpenLoadModal?.('B')}
              className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 text-xs gap-1 bg-[#0a0a0a]/90 hover:bg-[#121212] cursor-pointer transition"
            >
              <span className="font-bold text-purple-400">Deck B: No Video</span>
              <span className="text-[10px] text-zinc-400">Click to load YouTube video or KeyDB track</span>
            </div>
          )}

          {/* Deck B HUD Banner */}
          {deckState.B.hasVideo && (
            <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/80 px-2 py-0.5 rounded backdrop-blur-md border border-purple-500/40 shadow-lg">
              <span className="text-[10px] font-bold text-purple-400">DECK B</span>
              <span className="text-[10px] text-zinc-200 truncate max-w-[140px]">
                {deckState.B.title}
              </span>
              <button
                type="button"
                onClick={() => youtubeBridge.togglePlay('B')}
                className="ml-1 px-1.5 py-0.5 rounded bg-purple-500/20 hover:bg-purple-500 text-purple-300 hover:text-black text-[10px] font-bold transition"
                title={deckState.B.playing ? 'Pause' : 'Play'}
              >
                {deckState.B.playing ? '❚❚' : '▶'}
              </button>
              {onEjectDeck && (
                <button
                  type="button"
                  onClick={() => onEjectDeck('B')}
                  className="ml-0.5 text-[10px] text-zinc-400 hover:text-red-400 font-bold"
                  title="Eject video"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Deck B Warning Banner */}
          {deckState.B.errorMessage && (
            <div className="absolute inset-x-2 bottom-2 z-10 bg-red-950/90 border border-red-500/60 rounded px-2.5 py-1 text-[10px] text-red-200 flex items-center justify-between backdrop-blur-md">
              <span className="truncate">⚠️ {deckState.B.errorMessage}</span>
              <button
                type="button"
                onClick={() => onOpenLoadModal?.('B')}
                className="underline font-bold text-white ml-2 shrink-0 hover:text-red-300"
              >
                Change
              </button>
            </div>
          )}
        </div>

        {/* VJ Blend HUD overlay */}
        {displayMode === 'vj-blend' && hasAnyVideo && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 bg-black/80 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 flex items-center gap-3 text-[10px] text-zinc-300 shadow-xl">
            <span
              className={`font-mono ${
                opacityA > 0.5 ? 'text-emerald-400 font-bold' : 'text-zinc-500'
              }`}
            >
              A: {Math.round(opacityA * 100)}%
            </span>
            <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden relative">
              <div
                className="absolute top-0 bottom-0 w-2 bg-accent rounded-full transition-all"
                style={{ left: `calc(${normCrossfade * 100}% - 4px)` }}
              />
            </div>
            <span
              className={`font-mono ${
                opacityB > 0.5 ? 'text-purple-400 font-bold' : 'text-zinc-500'
              }`}
            >
              B: {Math.round(opacityB * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
