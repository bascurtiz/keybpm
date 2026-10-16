import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import { DeckEngine, type KeyLockEngine } from './deck-engine'
import type { DeckId } from './types'
import { getVinylWorkletUrl } from './vinyl-worklet'
import { MixRecorder, type MixTimeline } from './mix-timeline'
import {
  LIMITER_SETTINGS,
  renderMix as renderMixOffline,
  type MixRenderOptions,
  type MixRenderProgress,
  type RenderedMix,
} from './mix-renderer'

/**
 * Top-level audio graph: two decks -> master gain -> limiter -> destination.
 * Analyzers feed master VU meters and bass reactivity.
 */
export class AudioEngine {
  readonly ctx: AudioContext
  readonly master: GainNode
  readonly limiter: DynamicsCompressorNode
  readonly masterAnalyser: AnalyserNode
  readonly masterAnalyserL: AnalyserNode
  readonly masterAnalyserR: AnalyserNode
  readonly glowAnalyser: AnalyserNode
  readonly decks: Record<DeckId, DeckEngine>

  /** Captures the performance; rendering happens afterwards, offline. */
  private recorder: MixRecorder | null = null
  recordingStartedAt: number | null = null
  /** Most recent rendered mix, so the UI can offer it for download. */
  lastMix: RenderedMix | null = null
  /** Live render progress, or null when no render is running. */
  renderProgress: MixRenderProgress | null = null

  crossfade = 0
  masterVolume = 0.9
  masterBpm = 128
  version = 0
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.version++
    for (const listener of this.listeners) listener()
  }

  constructor() {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext

    this.ctx = new AudioContextClass({ latencyHint: 'interactive' })
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9

    // Brickwall limiter, shared with the offline renderer so a rendered mix
    // and live playback are limited identically.
    this.limiter = this.ctx.createDynamicsCompressor()
    this.limiter.threshold.value = LIMITER_SETTINGS.threshold
    this.limiter.knee.value = LIMITER_SETTINGS.knee
    this.limiter.ratio.value = LIMITER_SETTINGS.ratio
    this.limiter.attack.value = LIMITER_SETTINGS.attack
    this.limiter.release.value = LIMITER_SETTINGS.release
    this.master.connect(this.limiter)

    this.masterAnalyser = this.ctx.createAnalyser()
    this.masterAnalyser.fftSize = 1024

    this.limiter.connect(this.masterAnalyser)
    this.masterAnalyser.connect(this.ctx.destination)

    // Stereo split for VU meters
    this.masterAnalyserL = this.ctx.createAnalyser()
    this.masterAnalyserL.fftSize = 1024
    this.masterAnalyserR = this.ctx.createAnalyser()
    this.masterAnalyserR.fftSize = 1024
    const splitter = this.ctx.createChannelSplitter(2)
    this.limiter.connect(splitter)
    splitter.connect(this.masterAnalyserL, 0)
    splitter.connect(this.masterAnalyserR, 1)

    // Low-passed glow tap for audio-reactive pulse
    const glowFilter = this.ctx.createBiquadFilter()
    glowFilter.type = 'lowpass'
    glowFilter.frequency.value = 70
    glowFilter.Q.value = 0.7
    this.glowAnalyser = this.ctx.createAnalyser()
    this.glowAnalyser.fftSize = 512
    this.limiter.connect(glowFilter)
    glowFilter.connect(this.glowAnalyser)

    // Register audio worklets: vinyl player, Rubberband R3 & SoundTouch fallback
    const vinylWorkletReady = this.ctx.audioWorklet.addModule(getVinylWorkletUrl())

    const rubberbandUrl = `${import.meta.env.BASE_URL}rubberband-processor.js`
    const rubberbandReady = this.ctx.audioWorklet.addModule(rubberbandUrl).catch(err => {
      console.warn('RubberBand worklet registration failed, will fallback to SoundTouch:', err)
    })

    const soundTouchUrl = `${import.meta.env.BASE_URL}soundtouch-processor.js`
    const soundTouchReady = SoundTouchNode.register(this.ctx, soundTouchUrl).catch(err => {
      console.warn('SoundTouch registration failed:', err)
    })

    this.decks = {
      A: new DeckEngine(this.ctx, this.master, vinylWorkletReady, rubberbandReady, soundTouchReady),
      B: new DeckEngine(this.ctx, this.master, vinylWorkletReady, rubberbandReady, soundTouchReady),
    }

    // Mirror the Master Tempo onto both decks. The SCR cutter reads it as the
    // tempo to play its sample at when the deck has no track of its own.
    this.decks.A.setMasterBpm(this.masterBpm)
    this.decks.B.setMasterBpm(this.masterBpm)

    this.setCrossfade(0)
    this.startPllLoop()
  }

  private pllTimer: number | null = null

  private startPllLoop() {
    if (typeof window === 'undefined') return
    if (this.pllTimer !== null) return

    this.pllTimer = window.setInterval(() => {
      this.updatePllSync()
    }, 20)
  }

  private updatePllSync() {
    for (const id of ['A', 'B'] as const) {
      const follower = this.decks[id]
      if (!follower.syncLocked) continue
      const master = follower.syncTargetDeck
      if (!master || !follower.playing || !master.playing || follower.scratching || master.scratching) {
        continue
      }

      // Local tempo at each playhead, so a follower tracks a master that is
      // drifting rather than locking onto its average tempo.
      const ownBpm = follower.localBpm
      const masterBpm = master.localBpm
      if (!ownBpm || !masterBpm) continue

      const targetRate = (masterBpm * master.rate) / ownBpm

      // Keep follower tempo locked to master pitch changes
      if (Math.abs(follower.rate - targetRate) > 0.0001) {
        follower.setRate(targetRate, true)
      }
      // Ensure constant playback rate without any 4-beat pitch/speed flutter
      follower.applyPllCorrection(1.0)
    }
  }

  async resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  /**
   * Realtime keylock engine for both decks (SoundTouch by default).
   *
   * Kept as a single switch so both decks change together — a mix where one deck
   * keylocks with Rubber Band and the other with SoundTouch would sound like two
   * different rooms. See `DeckEngine.setKeyLockEngine` for why the default is the
   * engine that is a couple of cents off rather than the exact one.
   */
  get keyLockEngine(): KeyLockEngine {
    return this.decks.A.keyLockEngine
  }

  /**
   * Whether Rubber Band can be selected.
   *
   * Both decks have to be ready, not just one: {@link setKeyLockEngine} moves them together,
   * and if only one switched the mix would be half SoundTouch and half Rubber Band, which is
   * exactly the split this single switch exists to prevent.
   */
  get rubberBandAvailable(): boolean {
    return this.decks.A.rubberBandAvailable && this.decks.B.rubberBandAvailable
  }

  setKeyLockEngine(engine: KeyLockEngine) {
    for (const id of ['A', 'B'] as const) this.decks[id].setKeyLockEngine(engine)
    this.emit()
  }

  /**
   * value in -1 (full A) .. 1 (full B).
   * DJ plateau curve: each deck stays full across its half, fades on opposite half.
   */
  setCrossfade(value: number) {
    this.crossfade = Math.min(1, Math.max(-1, value))
    const fadeA = Math.max(0, this.crossfade)
    const fadeB = Math.max(0, -this.crossfade)
    this.decks.A.setCrossfadeGain(Math.cos((fadeA * Math.PI) / 2))
    this.decks.B.setCrossfadeGain(Math.cos((fadeB * Math.PI) / 2))
    this.emit()
  }

  setMasterVolume(volume: number) {
    this.masterVolume = Math.min(1, Math.max(0, volume))
    this.master.gain.setTargetAtTime(
      this.masterVolume * this.masterVolume,
      this.ctx.currentTime,
      0.01
    )
    this.emit()
  }

  setMasterBpm(bpm: number, syncDecks = true) {
    const validBpm = Math.max(20, Math.min(300, Math.round(bpm * 10) / 10))
    this.masterBpm = validBpm
    // The decks mirror this for the SCR cutter's fallback tempo, whether or not
    // the pitch faders are being re-driven below.
    this.decks.A.setMasterBpm(validBpm)
    this.decks.B.setMasterBpm(validBpm)
    if (syncDecks) {
      // fromSync=true so locked SYNC is not silently disengaged by a master BPM edit.
      const ownA = this.decks.A.localBpm
      if (ownA) this.decks.A.setRate(validBpm / ownA, true)
      const ownB = this.decks.B.localBpm
      if (ownB) this.decks.B.setRate(validBpm / ownB, true)
    }
    this.emit()
  }

  get snapMode(): boolean {
    return this.decks.A.snapMode && this.decks.B.snapMode
  }

  setSnapMode(on: boolean) {
    this.decks.A.setSnapMode(on)
    this.decks.B.setSnapMode(on)
    this.emit()
  }

  toggleSnapMode() {
    this.setSnapMode(!this.snapMode)
  }

  get quantMode(): boolean {
    return this.decks.A.quantMode && this.decks.B.quantMode
  }

  setQuantMode(on: boolean) {
    this.decks.A.setQuantMode(on)
    this.decks.B.setQuantMode(on)
    this.emit()
  }

  toggleQuantMode() {
    this.setQuantMode(!this.quantMode)
  }

  get recording() {
    return this.recorder?.recording ?? false
  }

  /** Seconds captured so far, for a recording timer. */
  get recordingSeconds(): number {
    return this.recorder?.elapsedSeconds ?? 0
  }

  /**
   * Starts capturing the performance. Nothing is written to disk or encoded
   * while this runs: the mix is rebuilt later from the captured timeline.
   */
  startRecording() {
    if (this.recording) return
    this.recorder = new MixRecorder(this)
    this.recorder.start()
    this.recordingStartedAt = performance.now()
    this.emit()
  }

  /** Stops capture and returns what was performed, or null if nothing played. */
  stopRecording(): MixTimeline | null {
    const timeline = this.recorder?.stop() ?? null
    this.recorder = null
    this.recordingStartedAt = null
    this.emit()
    return timeline
  }

  /**
   * Renders a captured timeline offline into a WAV file.
   *
   * This is a real render, not a save: every keylocked segment is time-stretched
   * again at a quality realtime playback cannot afford. Progress is published on
   * the engine so the UI can show it.
   */
  async renderRecording(
    timeline: MixTimeline,
    options: MixRenderOptions = {}
  ): Promise<RenderedMix> {
    this.renderProgress = { phase: 'measuring' }
    this.emit()
    try {
      const rendered = await renderMixOffline(timeline, {
        ...options,
        onProgress: progress => {
          this.renderProgress = progress
          options.onProgress?.(progress)
          this.emit()
        },
      })
      this.lastMix = rendered
      return rendered
    } finally {
      this.renderProgress = null
      this.emit()
    }
  }
}

let engineInstance: AudioEngine | null = null

export function getAudioEngine(): AudioEngine {
  if (typeof window === 'undefined') {
    throw new Error('AudioEngine is client-only')
  }
  if (!engineInstance) {
    engineInstance = new AudioEngine()
  }
  return engineInstance
}
