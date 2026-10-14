import { youtubeId } from '../youtube'

export interface YouTubeTrackInfo {
  videoId: string
  title: string
  artist?: string
  bpm?: number
  camelot?: string
  key?: string
  duration?: number
  coverUrl?: string
}

export interface YouTubeDeckState {
  deckId: 'A' | 'B'
  videoId: string | null
  title: string
  artist: string
  bpm: number
  camelot: string | null
  key: string | null
  duration: number
  currentTime: number
  playing: boolean
  buffering: boolean
  volume: number // 0-100
  playbackRate: number // 0.5 - 2.0
  isReady: boolean
  hasVideo: boolean
  errorMessage?: string | null
}

declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
    KEYBPM_YOUTUBE_BRIDGE?: YouTubeBridge
    YouDJ?: any
  }
}

/**
 * YouTubeBridge manages dual YouTube IFrame instances for Deck A and Deck B.
 * It provides a bidirectional bridge for transport controls, crossfader volume curves,
 * tempo pitch adjustment, and real-time playback state synchronization.
 */
export class YouTubeBridge {
  public players: Record<'A' | 'B', any | null> = { A: null, B: null }
  private hostElements: Record<'A' | 'B', HTMLElement | null> = { A: null, B: null }
  private isApiLoaded = false
  private apiReadyPromise: Promise<void> | null = null

  public state: Record<'A' | 'B', YouTubeDeckState> = {
    A: {
      deckId: 'A',
      videoId: null,
      title: 'No Video Loaded',
      artist: '',
      bpm: 128,
      camelot: null,
      key: null,
      duration: 0,
      currentTime: 0,
      playing: false,
      buffering: false,
      volume: 100,
      playbackRate: 1,
      isReady: false,
      hasVideo: false,
      errorMessage: null,
    },
    B: {
      deckId: 'B',
      videoId: null,
      title: 'No Video Loaded',
      artist: '',
      bpm: 128,
      camelot: null,
      key: null,
      duration: 0,
      currentTime: 0,
      playing: false,
      buffering: false,
      volume: 100,
      playbackRate: 1,
      isReady: false,
      hasVideo: false,
      errorMessage: null,
    },
  }

  private listeners = new Set<() => void>()
  private pollingTimer: number | null = null
  private currentCrossfade = 0 // -1 (A) .. 1 (B)
  private masterGain = 1.0

  constructor() {
    this.startStatePolling()
    this.exposeGlobalBridge()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public emit() {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err) {
        console.error('YouTubeBridge listener error:', err)
      }
    }
  }

  /**
   * Dynamically loads the YouTube IFrame API script tag.
   */
  public ensureApi(): Promise<void> {
    if (this.isApiLoaded && window.YT?.Player) {
      return Promise.resolve()
    }
    if (this.apiReadyPromise) {
      return this.apiReadyPromise
    }

    this.apiReadyPromise = new Promise<void>(resolve => {
      if (typeof window === 'undefined') {
        resolve()
        return
      }

      if (window.YT && window.YT.Player) {
        this.isApiLoaded = true
        resolve()
        return
      }

      const prevReady = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        this.isApiLoaded = true
        if (prevReady) prevReady()
        resolve()
      }

      const existingScript = document.getElementById('youtube-iframe-api')
      if (!existingScript) {
        const tag = document.createElement('script')
        tag.id = 'youtube-iframe-api'
        tag.src = 'https://www.youtube.com/iframe_api'
        const firstScript = document.getElementsByTagName('script')[0]
        firstScript.parentNode?.insertBefore(tag, firstScript)
      }
    })

    return this.apiReadyPromise
  }

  /**
   * Mounts a player into a host DOM element (or element ID).
   * Appends an inner target div so React virtual DOM reconciliation
   * never destroys or replaces the generated iframe.
   */
  public async mountPlayer(deckId: 'A' | 'B', host: string | HTMLElement): Promise<void> {
    await this.ensureApi()

    let hostEl: HTMLElement | null = null
    if (typeof host === 'string') {
      hostEl = document.getElementById(host)
    } else {
      hostEl = host
    }

    if (!hostEl) {
      console.warn(`[YouTubeBridge] Host element for Deck ${deckId} not found`)
      return
    }

    this.hostElements[deckId] = hostEl

    // If no video is queued or loaded yet, register the host element and return.
    // YT.Player requires a videoId to initialize and fire onReady properly.
    const activeVideoId = this.state[deckId].videoId
    if (!activeVideoId) {
      return
    }

    // If player already mounted in this exact host, don't recreate unless needed
    if (this.players[deckId]) {
      try {
        this.players[deckId].destroy()
      } catch {}
      this.players[deckId] = null
    }

    // Clean existing children inside host element
    while (hostEl.firstChild) {
      hostEl.removeChild(hostEl.firstChild)
    }

    // Create a target mounting div that YT.Player will replace with an iframe
    const targetDiv = document.createElement('div')
    targetDiv.id = `yt-player-target-${deckId}-${Date.now()}`
    targetDiv.style.width = '100%'
    targetDiv.style.height = '100%'
    hostEl.appendChild(targetDiv)

    return new Promise(resolve => {
      try {
        const player = new window.YT.Player(targetDiv.id, {
          height: '100%',
          width: '100%',
          videoId: activeVideoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              this.players[deckId] = player
              this.state[deckId].isReady = true

              try {
                player.cueVideoById({
                  videoId: activeVideoId,
                  startSeconds: 0,
                })
              } catch (e) {
                console.warn(`Error cueing video on ready for Deck ${deckId}:`, e)
              }

              this.syncCrossfade(this.currentCrossfade, this.masterGain)
              this.emit()
              resolve()
            },
            onStateChange: (event: any) => {
              this.handleStateChange(deckId, event.data)
            },
            onError: (e: any) => {
              console.warn(`YouTube Deck ${deckId} error:`, e)
              this.state[deckId].buffering = false
              if (e.data === 101 || e.data === 150) {
                this.state[deckId].errorMessage = 'Owner restricted video embedding on third-party sites'
              } else if (e.data === 100) {
                this.state[deckId].errorMessage = 'Video not found or removed'
              } else if (e.data === 2) {
                this.state[deckId].errorMessage = 'Invalid YouTube video ID parameter'
              } else {
                this.state[deckId].errorMessage = `Playback restricted (Code ${e.data})`
              }
              this.emit()
            },
          },
        })
      } catch (err) {
        console.error(`Failed to instantiate YT.Player on Deck ${deckId}:`, err)
        resolve()
      }
    })
  }

  private handleStateChange(deckId: 'A' | 'B', playerState: number) {
    const s = this.state[deckId]
    const YTState = window.YT?.PlayerState

    if (!YTState) return

    switch (playerState) {
      case YTState.PLAYING:
        s.playing = true
        s.buffering = false
        // Update duration if not set
        if (this.players[deckId]?.getDuration) {
          const dur = this.players[deckId].getDuration()
          if (dur > 0) s.duration = dur
        }
        break
      case YTState.PAUSED:
        s.playing = false
        s.buffering = false
        break
      case YTState.BUFFERING:
        s.buffering = true
        break
      case YTState.ENDED:
        s.playing = false
        s.buffering = false
        s.currentTime = s.duration
        break
      case YTState.CUED:
        s.playing = false
        s.buffering = false
        if (this.players[deckId]?.getDuration) {
          const dur = this.players[deckId].getDuration()
          if (dur > 0) s.duration = dur
        }
        break
    }
    this.emit()
  }

  /**
   * Load video onto Deck A or Deck B.
   */
  public async loadVideo(
    deckId: 'A' | 'B',
    urlOrId: string,
    metadata?: Partial<YouTubeTrackInfo>
  ): Promise<boolean> {
    const videoId = youtubeId(urlOrId) || (urlOrId.length >= 10 && !urlOrId.includes('/') ? urlOrId.trim() : null)
    if (!videoId) return false

    await this.ensureApi()

    const deck = this.state[deckId]
    deck.videoId = videoId
    deck.title = metadata?.title || `YouTube Track (${videoId})`
    deck.artist = metadata?.artist || 'YouTube'
    deck.bpm = metadata?.bpm || 128
    deck.camelot = metadata?.camelot || null
    deck.key = metadata?.key || null
    deck.duration = metadata?.duration || 0
    deck.currentTime = 0
    deck.playing = false
    deck.buffering = false
    deck.hasVideo = true
    deck.errorMessage = null

    const player = this.players[deckId]
    if (player && typeof player.cueVideoById === 'function') {
      try {
        player.cueVideoById({
          videoId,
          startSeconds: 0,
        })
        this.syncCrossfade(this.currentCrossfade, this.masterGain)
      } catch (err) {
        console.warn(`Failed to cue video on Deck ${deckId}:`, err)
      }
    } else if (this.hostElements[deckId]) {
      await this.mountPlayer(deckId, this.hostElements[deckId]!)
    }

    this.emit()
    return true
  }

  public play(deckId: 'A' | 'B') {
    const p = this.players[deckId]
    if (p && typeof p.playVideo === 'function') {
      try {
        p.playVideo()
        this.state[deckId].playing = true
        this.emit()
      } catch (err) {
        console.warn(`Failed to play Deck ${deckId}:`, err)
      }
    }
  }

  public pause(deckId: 'A' | 'B') {
    const p = this.players[deckId]
    if (p && typeof p.pauseVideo === 'function') {
      try {
        p.pauseVideo()
        this.state[deckId].playing = false
        this.emit()
      } catch (err) {
        console.warn(`Failed to pause Deck ${deckId}:`, err)
      }
    }
  }

  public togglePlay(deckId: 'A' | 'B') {
    if (this.state[deckId].playing) {
      this.pause(deckId)
    } else {
      this.play(deckId)
    }
  }

  public seekTo(deckId: 'A' | 'B', seconds: number) {
    const p = this.players[deckId]
    if (p && typeof p.seekTo === 'function') {
      try {
        p.seekTo(seconds, true)
        this.state[deckId].currentTime = seconds
        this.emit()
      } catch (err) {
        console.warn(`Failed to seek Deck ${deckId}:`, err)
      }
    }
  }

  public setPlaybackRate(deckId: 'A' | 'B', rate: number) {
    const clamped = Math.max(0.5, Math.min(2.0, rate))
    const p = this.players[deckId]
    if (p && typeof p.setPlaybackRate === 'function') {
      try {
        p.setPlaybackRate(clamped)
      } catch {}
    }
    this.state[deckId].playbackRate = clamped
    this.emit()
  }

  public setVolume(deckId: 'A' | 'B', volumePercent: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)))
    const p = this.players[deckId]
    if (p && typeof p.setVolume === 'function') {
      try {
        p.setVolume(clamped)
      } catch {}
    }
    this.state[deckId].volume = clamped
  }

  /**
   * Synchronize crossfader with DJ plateau curve.
   * crossfade: -1 (Full Deck A) ... 0 (Center / Both) ... +1 (Full Deck B)
   */
  public syncCrossfade(crossfadeValue: number, masterVolume = 1.0) {
    this.currentCrossfade = Math.min(1, Math.max(-1, crossfadeValue))
    this.masterGain = Math.min(1, Math.max(0, masterVolume))

    // Equal-power DJ plateau crossfade curve:
    // At center (0): both at 100%
    // At -1: Deck A = 100%, Deck B = 0%
    // At +1: Deck A = 0%, Deck B = 100%
    const fadeA = Math.max(0, this.currentCrossfade) // 0 .. 1
    const fadeB = Math.max(0, -this.currentCrossfade) // 0 .. 1

    const gainA = Math.cos((fadeA * Math.PI) / 2)
    const gainB = Math.cos((fadeB * Math.PI) / 2)

    this.setVolume('A', gainA * 100 * this.masterGain)
    this.setVolume('B', gainB * 100 * this.masterGain)
  }

  public eject(deckId: 'A' | 'B') {
    const p = this.players[deckId]
    if (p && typeof p.stopVideo === 'function') {
      try {
        p.stopVideo()
      } catch {}
    }
    const deck = this.state[deckId]
    deck.videoId = null
    deck.title = 'No Video Loaded'
    deck.artist = ''
    deck.duration = 0
    deck.currentTime = 0
    deck.playing = false
    deck.buffering = false
    deck.hasVideo = false
    deck.errorMessage = null
    this.emit()
  }

  public destroy() {
    if (this.pollingTimer !== null) {
      clearTimeout(this.pollingTimer)
      this.pollingTimer = null
    }
    for (const id of ['A', 'B'] as const) {
      if (this.players[id]) {
        try {
          this.players[id].destroy()
        } catch {}
        this.players[id] = null
      }
    }
  }

  private startStatePolling() {
    if (typeof window === 'undefined') return

    const poll = () => {
      let changed = false
      for (const id of ['A', 'B'] as const) {
        const p = this.players[id]
        const s = this.state[id]
        if (p && s.isReady && s.hasVideo) {
          try {
            const time = p.getCurrentTime()
            const dur = p.getDuration()
            if (typeof time === 'number' && Math.abs(time - s.currentTime) > 0.05) {
              s.currentTime = time
              changed = true
            }
            if (typeof dur === 'number' && dur > 0 && Math.abs(dur - s.duration) > 0.5) {
              s.duration = dur
              changed = true
            }
          } catch {}
        }
      }
      if (changed) this.emit()
      this.pollingTimer = window.setTimeout(poll, 120)
    }

    poll()
  }

  /**
   * Expose global bidirectional JS bridge (YouDJ / DJAPPMM compliant)
   */
  private exposeGlobalBridge() {
    if (typeof window === 'undefined') return

    window.KEYBPM_YOUTUBE_BRIDGE = this

    // Bidirectional JS bridge compatible with Beatport DJ / YouDJ paradigm
    window.YouDJ = {
      ready: true,
      loadsong: (
        deckId: number,
        url: string,
        title: string,
        _tag?: string,
        keys?: string,
        duration?: number
      ) => {
        const targetDeck = deckId === 1 ? 'A' : 'B'
        void this.loadVideo(targetDeck, url, {
          title,
          duration,
          camelot: keys?.split('/')[1]?.trim(),
        })
      },
      send_command: (command: string, value?: number) => {
        switch (command) {
          case 'PLAY.A':
            this.togglePlay('A')
            break
          case 'PLAY.B':
            this.togglePlay('B')
            break
          case 'CROSSFADER':
            if (typeof value === 'number') {
              // MIDI 0-127 mapped to -1 .. 1
              this.syncCrossfade((value / 127) * 2 - 1)
            }
            break
        }
      },
    }
  }
}

// Export singleton instance
export const youtubeBridge = new YouTubeBridge()
