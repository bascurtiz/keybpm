import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import { DeckEngine } from './deck-engine'
import type { DeckId } from './types'
import { getVinylWorkletUrl } from './vinyl-worklet'

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

  private readonly recordDest: MediaStreamAudioDestinationNode
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  recordingStartedAt: number | null = null

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

    // Brickwall limiter
    this.limiter = this.ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -1.5
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.002
    this.limiter.release.value = 0.25
    this.master.connect(this.limiter)

    this.masterAnalyser = this.ctx.createAnalyser()
    this.masterAnalyser.fftSize = 1024
    this.recordDest = this.ctx.createMediaStreamDestination()

    this.limiter.connect(this.masterAnalyser)
    this.masterAnalyser.connect(this.ctx.destination)
    this.limiter.connect(this.recordDest)

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

    // Register audio worklets: vinyl player & SoundTouch (Key Lock)
    const vinylWorkletReady = this.ctx.audioWorklet.addModule(getVinylWorkletUrl())

    const soundTouchUrl = `${import.meta.env.BASE_URL}soundtouch-processor.js`
    const soundTouchReady = SoundTouchNode.register(this.ctx, soundTouchUrl).catch(err => {
      console.warn('SoundTouch registration failed, fallback to direct audio:', err)
    })

    this.decks = {
      A: new DeckEngine(this.ctx, this.master, vinylWorkletReady, soundTouchReady),
      B: new DeckEngine(this.ctx, this.master, vinylWorkletReady, soundTouchReady),
    }

    this.setCrossfade(0)
  }

  async resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
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
    if (syncDecks) {
      if (this.decks.A.track?.bpm) {
        this.decks.A.setRate(validBpm / this.decks.A.track.bpm)
      }
      if (this.decks.B.track?.bpm) {
        this.decks.B.setRate(validBpm / this.decks.B.track.bpm)
      }
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
    return this.recorder?.state === 'recording'
  }

  startRecording() {
    if (this.recording) return
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m =>
      MediaRecorder.isTypeSupported(m)
    )
    this.chunks = []
    this.recorder = new MediaRecorder(this.recordDest.stream, mime ? { mimeType: mime } : undefined)
    this.recorder.ondataavailable = e => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start(1000)
    this.recordingStartedAt = performance.now()
    this.emit()
  }

  stopRecording(): Promise<Blob | null> {
    return new Promise(resolve => {
      const rec = this.recorder
      if (!rec || rec.state !== 'recording') {
        resolve(null)
        return
      }
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' })
        this.chunks = []
        this.recordingStartedAt = null
        this.emit()
        resolve(blob)
      }
      rec.stop()
      this.recorder = null
    })
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
