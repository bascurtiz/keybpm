import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import { HOT_CUE_COUNT, type FxType, type LoopRegion, type Track } from './types'
import { positiveMod } from './dsp'

interface WorkletMessage {
  t: string
  s?: number
  f?: number
}

/**
 * Deck audio graph:
 * vinyl worklet -> [KeyLock Stage (SoundTouchNode vs Bypass)] -> autoGain -> trim ->
 * 3-band EQ -> filter -> channel fader -> crossfader gain -> master.
 *
 * KEYLOCK:
 * Keylock (Master Tempo) preserves original pitch when tempo/playbackRate changes.
 * Enabled by default as requested. When active, SoundTouchNode compensates the pitch
 * proportionally. When scratching, bypassing or rate == 1.0, clean direct path is used.
 */
export class DeckEngine {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode

  private readonly autoGain: GainNode
  private readonly trim: GainNode
  private readonly eqLow: BiquadFilterNode
  private readonly eqMid: BiquadFilterNode
  private readonly eqHigh: BiquadFilterNode
  private readonly filter: BiquadFilterNode
  private readonly fader: GainNode
  private readonly xfade: GainNode

  // KeyLock / Master Tempo nodes
  private _keyLock = true
  private stNode: SoundTouchNode | null = null
  private readonly keyLockDryGain: GainNode
  private readonly keyLockWetGain: GainNode

  // FX sends (post-filter, pre-fader)
  private readonly echoSend: GainNode
  private readonly echoDelay: DelayNode
  private readonly echoFeedback: GainNode
  private readonly echoWet: GainNode
  private readonly reverbSend: GainNode
  private readonly reverb: ConvolverNode
  private readonly reverbWet: GainNode
  private readonly flangerSend: GainNode
  private readonly flangerDelay: DelayNode
  private readonly flangerFeedback: GainNode
  private readonly flangerWet: GainNode

  private _fxType: FxType = 'off'
  private _fxWet = 0.5
  private _fxBeats = 0.5
  private _slipMode = false

  private vinylNode: AudioWorkletNode | null = null
  private pendingMessages: { msg: unknown; transfer?: Transferable[] }[] = []

  track: Track | null = null
  hotCues: (number | null)[] = Array(HOT_CUE_COUNT).fill(null)
  cuePoint = 0
  loop: LoopRegion | null = null

  // Snap & Quantize modes (Default ON as required for DJ performance)
  snapMode = true
  quantMode = true
  private quantizeTimer: number | null = null
  private pendingQuantizedCue: number | null = null
  private pendingQuantizedIndex: number | null = null

  get isWaitingQuantizedCue(): boolean {
    return this.pendingQuantizedCue !== null
  }

  get waitingCueIndex(): number | null {
    return this.pendingQuantizedIndex
  }

  setSnapMode(on: boolean) {
    this.snapMode = on
    this.emit()
  }

  toggleSnapMode() {
    this.setSnapMode(!this.snapMode)
  }

  setQuantMode(on: boolean) {
    this.quantMode = on
    this.emit()
  }

  toggleQuantMode() {
    this.setQuantMode(!this.quantMode)
  }

  private _playing = false
  private _scratching = false
  private _rate = 1
  private _nudgeFactor = 1.0
  private posSeconds = 0
  private posFrame = 0

  version = 0
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    vinylWorkletReady: Promise<unknown>,
    soundTouchReady?: Promise<unknown>
  ) {
    this.ctx = ctx
    this.autoGain = ctx.createGain()
    this.trim = ctx.createGain()

    // Keylock splitting gains
    this.keyLockDryGain = ctx.createGain()
    this.keyLockWetGain = ctx.createGain()
    this.keyLockDryGain.gain.value = 1
    this.keyLockWetGain.gain.value = 0

    this.keyLockDryGain.connect(this.autoGain)
    this.keyLockWetGain.connect(this.autoGain)

    this.eqLow = ctx.createBiquadFilter()
    this.eqLow.type = 'lowshelf'
    this.eqLow.frequency.value = 320

    this.eqMid = ctx.createBiquadFilter()
    this.eqMid.type = 'peaking'
    this.eqMid.frequency.value = 1000
    this.eqMid.Q.value = 0.9

    this.eqHigh = ctx.createBiquadFilter()
    this.eqHigh.type = 'highshelf'
    this.eqHigh.frequency.value = 3200

    this.filter = ctx.createBiquadFilter()
    this.setFilter(0)

    this.fader = ctx.createGain()
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.xfade = ctx.createGain()

    this.autoGain.connect(this.trim)
    this.trim.connect(this.eqLow)
    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)
    this.eqHigh.connect(this.filter)
    this.filter.connect(this.fader)
    this.fader.connect(this.analyser)
    this.analyser.connect(this.xfade)
    this.xfade.connect(destination)

    // ----- FX chains -----
    this.echoSend = ctx.createGain()
    this.echoSend.gain.value = 0
    this.echoDelay = ctx.createDelay(2)
    this.echoFeedback = ctx.createGain()
    this.echoFeedback.gain.value = 0
    const echoTone = ctx.createBiquadFilter()
    echoTone.type = 'lowpass'
    echoTone.frequency.value = 4000
    this.echoWet = ctx.createGain()
    this.echoWet.gain.value = 0
    this.filter.connect(this.echoSend)
    this.echoSend.connect(this.echoDelay)
    this.echoDelay.connect(this.echoWet)
    this.echoDelay.connect(echoTone)
    echoTone.connect(this.echoFeedback)
    this.echoFeedback.connect(this.echoDelay)
    this.echoWet.connect(this.fader)

    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0
    this.reverb = ctx.createConvolver()
    this.reverbWet = ctx.createGain()
    this.reverbWet.gain.value = 0
    this.filter.connect(this.reverbSend)
    this.reverbSend.connect(this.reverb)
    this.reverb.connect(this.reverbWet)
    this.reverbWet.connect(this.fader)

    this.flangerSend = ctx.createGain()
    this.flangerSend.gain.value = 0
    this.flangerDelay = ctx.createDelay(0.05)
    this.flangerDelay.delayTime.value = 0.0025
    this.flangerFeedback = ctx.createGain()
    this.flangerFeedback.gain.value = 0
    this.flangerWet = ctx.createGain()
    this.flangerWet.gain.value = 0
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.25
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = 0.0018
    lfo.connect(lfoDepth)
    lfoDepth.connect(this.flangerDelay.delayTime)
    lfo.start()
    this.filter.connect(this.flangerSend)
    this.flangerSend.connect(this.flangerDelay)
    this.flangerDelay.connect(this.flangerWet)
    this.flangerDelay.connect(this.flangerFeedback)
    this.flangerFeedback.connect(this.flangerDelay)
    this.flangerWet.connect(this.fader)

    // Initialize Vinyl player AudioWorklet
    vinylWorkletReady
      .then(() => {
        const node = new AudioWorkletNode(ctx, 'vinyl-player', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        })
        node.port.onmessage = (e: MessageEvent<WorkletMessage>) => this.onWorkletMessage(e.data)

        // Connect vinylNode to both dry bypass and wet keylock paths
        node.connect(this.keyLockDryGain)
        this.vinylNode = node

        for (const p of this.pendingMessages) {
          node.port.postMessage(p.msg, p.transfer ?? [])
        }
        this.pendingMessages = []

        // If SoundTouch is ready, hook it up as well
        if (soundTouchReady) {
          soundTouchReady
            .then(() => {
              try {
                this.stNode = new SoundTouchNode({
                  context: this.ctx,
                  outputChannelCount: 2,
                })
                node.connect(this.stNode)
                this.stNode.connect(this.keyLockWetGain)
                this.updateKeyLockRouting()
              } catch (err) {
                console.warn('SoundTouchNode instantiation skipped:', err)
              }
            })
            .catch(err => console.warn('SoundTouch worklet not ready:', err))
        }
      })
      .catch(err => console.error('vinyl worklet failed to load', err))
  }

  private post(msg: unknown, transfer?: Transferable[]) {
    if (this.vinylNode) this.vinylNode.port.postMessage(msg, transfer ?? [])
    else this.pendingMessages.push({ msg, transfer })
  }

  private onWorkletMessage(d: WorkletMessage) {
    if (d.t === 'pos' && d.s !== undefined) {
      this.posSeconds = d.s
      if (d.f !== undefined) this.posFrame = d.f
    } else if (d.t === 'ended') {
      this._playing = false
      this.emit()
    }
  }

  private emit() {
    this.version++
    for (const listener of this.listeners) listener()
  }

  // ----- state -----

  get playing() {
    return this._playing
  }

  get scratching() {
    return this._scratching
  }

  get rate() {
    return this._rate
  }

  get nudgeFactor() {
    return this._nudgeFactor
  }

  get duration() {
    return this.track?.duration ?? 0
  }

  get keyLock(): boolean {
    return true
  }

  setKeyLock(_on?: boolean) {
    this._keyLock = true
    this.updateKeyLockRouting()
    this.emit()
  }

  toggleKeyLock() {
    this._keyLock = true
    this.updateKeyLockRouting()
    this.emit()
  }

  private _keyShift = 0

  get keyShift(): number {
    return this._keyShift
  }

  setKeyShift(semitones: number) {
    this._keyShift = Math.max(-12, Math.min(12, Math.round(semitones)))
    this.updateKeyLockRouting()
    this.emit()
  }

  resetKeyShift() {
    this.setKeyShift(0)
  }

  private updateKeyLockRouting() {
    const t = this.ctx.currentTime
    const effectiveRate = this._rate * this._nudgeFactor
    const isOffPitch = Math.abs(effectiveRate - 1) > 0.001
    const useKeyLock = (this._keyLock && isOffPitch) || this._keyShift !== 0
    const active = useKeyLock && !this._scratching && !!this.stNode

    if (active && this.stNode) {
      const pitchRatio = Math.pow(2, this._keyShift / 12)
      this.stNode.playbackRate.setTargetAtTime(effectiveRate, t, 0.01)
      this.stNode.pitch.setTargetAtTime(this._keyLock ? pitchRatio : effectiveRate * pitchRatio, t, 0.01)
      this.keyLockWetGain.gain.setTargetAtTime(1, t, 0.015)
      this.keyLockDryGain.gain.setTargetAtTime(0, t, 0.015)
    } else {
      this.keyLockWetGain.gain.setTargetAtTime(0, t, 0.015)
      this.keyLockDryGain.gain.setTargetAtTime(1, t, 0.015)
    }
  }

  /** Effective BPM after pitch rate is applied. */
  get effectiveBpm(): number | null {
    if (!this.track?.bpm) return null
    return Math.round(this.track.bpm * this._rate * 100) / 100
  }

  get position(): number {
    return Math.min(Math.max(this.posSeconds, 0), this.duration)
  }

  get lastPosFrame(): number {
    return this.posFrame
  }

  positionAtFrame(frame: number): number {
    const rate = this._playing && !this._scratching ? this._rate : 0
    return this.posSeconds + ((frame - this.posFrame) / this.ctx.sampleRate) * rate
  }

  setTrackBpm(bpm: number) {
    if (!this.track) return
    const validBpm = Math.max(20, Math.min(300, Math.round(bpm * 10) / 10))
    this.track.bpm = validBpm
    if (this.track.grid) {
      this.track.grid.bpm = validBpm
      const beatLen = 60 / validBpm
      this.track.grid.firstBeat = positiveMod(this.track.grid.firstBar, beatLen)
    }
    this.updateFxTiming()
    this.emit()
  }

  setTrackKey(camelot: string, name?: string) {
    if (!this.track) return
    this.track.key = {
      name: name ?? camelot,
      camelot,
    }
    this.updateKeyLockRouting()
    this.emit()
  }

  // ----- beatgrid adjustment -----

  nudgeBeatGrid(deltaSeconds: number) {
    if (!this.track) return
    const bpm = this.track.grid?.bpm || this.track.bpm || 120
    const beatLen = 60 / bpm
    if (!this.track.grid) {
      this.track.grid = {
        bpm,
        firstBeat: 0,
        firstBar: 0,
        beatsPerBar: 4,
      }
    }
    this.track.grid.firstBar = Math.max(0, this.track.grid.firstBar + deltaSeconds)
    this.track.grid.firstBeat = positiveMod(this.track.grid.firstBar, beatLen)
    this.emit()
  }

  setBeat1AtPosition(pos?: number) {
    if (!this.track) return
    const targetPos = Math.max(0, pos ?? this.position)
    const bpm = this.track.grid?.bpm || this.track.bpm || 120
    const beatLen = 60 / bpm
    if (!this.track.grid) {
      this.track.grid = {
        bpm,
        firstBeat: positiveMod(targetPos, beatLen),
        firstBar: targetPos,
        beatsPerBar: 4,
      }
    } else {
      this.track.grid.firstBar = targetPos
      this.track.grid.firstBeat = positiveMod(targetPos, beatLen)
    }
    this.emit()
  }

  adjustGridBpm(deltaBpm: number) {
    if (!this.track) return
    const curBpm = this.track.grid?.bpm || this.track.bpm || 120
    const newBpm = Math.max(20, Math.min(300, Math.round((curBpm + deltaBpm) * 10) / 10))
    this.setTrackBpm(newBpm)
  }

  multiplyGridBpm(multiplier: 0.5 | 2) {
    if (!this.track) return
    const curBpm = this.track.grid?.bpm || this.track.bpm || 120
    const newBpm = Math.max(20, Math.min(300, Math.round(curBpm * multiplier * 10) / 10))
    this.setTrackBpm(newBpm)
  }

  // ----- track loading -----

  loadTrack(track: Track) {
    this.track = track
    this._playing = false
    this._scratching = false
    this.posSeconds = 0
    this.cuePoint = 0
    this.loop = null
    this.hotCues = Array(HOT_CUE_COUNT).fill(null)

    const buf = track.buffer
    const channels: ArrayBuffer[] = []
    for (let c = 0; c < Math.min(buf.numberOfChannels, 2); c++) {
      const data = new Float32Array(buf.length)
      buf.copyFromChannel(data, c)
      channels.push(data.buffer)
    }
    this.post({ t: 'load', channels, length: buf.length, rate: buf.sampleRate }, channels)
    this.autoGain.gain.setTargetAtTime(track.gain || 1, this.ctx.currentTime, 0.01)
    this.updateFxTiming()
    this.emit()
  }

  ejectTrack() {
    if (this.quantizeTimer) {
      window.clearTimeout(this.quantizeTimer)
      this.quantizeTimer = null
      this.pendingQuantizedCue = null
      this.pendingQuantizedIndex = null
    }
    this.pause()
    this.track = null
    this.posSeconds = 0
    this.cuePoint = 0
    this.loop = null
    this.hotCues = Array(HOT_CUE_COUNT).fill(null)
    this.emit()
  }

  // ----- transport -----

  async play() {
    if (!this.track || this._playing) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.posSeconds >= this.duration - 0.01) {
      this.posSeconds = 0
      this.post({ t: 'seek', s: 0 })
    }
    this.post({ t: 'play', rate: this._rate })
    this._playing = true
    this.updateKeyLockRouting()
    this.emit()
  }

  pause() {
    if (this.quantizeTimer) {
      window.clearTimeout(this.quantizeTimer)
      this.quantizeTimer = null
      this.pendingQuantizedCue = null
      this.pendingQuantizedIndex = null
    }
    if (!this._playing) return
    this.post({ t: 'pause' })
    this._playing = false
    this.emit()
  }

  async togglePlay() {
    if (this._playing) this.pause()
    else await this.play()
  }

  async cue() {
    if (!this.track) return
    if (this._playing) {
      if (this.quantizeTimer) {
        window.clearTimeout(this.quantizeTimer)
        this.quantizeTimer = null
        this.pendingQuantizedCue = null
        this.pendingQuantizedIndex = null
      }
      this.pause()
      this.seek(this.cuePoint)
    } else {
      this.cuePoint = this.snapMode ? this.snapToBeat(this.position) : this.position
      this.emit()
    }
  }

  seek(time: number) {
    if (!this.track) return
    const t = Math.min(Math.max(time, 0), this.duration)
    if (this.loop && (t < this.loop.start || t > this.loop.end)) {
      this.loop = null
      this.post({ t: 'loop', loop: null })
    }
    this.post({ t: 'seek', s: t })
    this.posSeconds = t
    this.emit()
  }

  beatJump(bars: number) {
    if (!this.track) return
    const grid = this.track.grid
    const bpm = grid?.bpm ?? this.track.bpm ?? 120
    const barLen = (60 / bpm) * (grid?.beatsPerBar ?? 4)
    this.seek(this.position + bars * barLen)
  }

  // ----- pitch -----

  setRate(rate: number) {
    this._rate = Math.max(0.2, Math.min(2.0, rate))
    this.post({ t: 'rate', rate: this._rate * this._nudgeFactor })
    this.updateFxTiming()
    this.updateKeyLockRouting()
    this.emit()
  }

  /**
   * Temporary pitch bend (nudge) while pushing button:
   * direction: -1 (slow down), +1 (speed up), 0 (release back to standard rate)
   */
  nudge(direction: -1 | 0 | 1, factor: number = 0.08) {
    if (direction === 0) {
      this._nudgeFactor = 1.0
    } else if (direction > 0) {
      this._nudgeFactor = 1.0 + factor
    } else {
      this._nudgeFactor = Math.max(0.1, 1.0 - factor)
    }

    if (!this._playing && direction !== 0) {
      this.seek(this.position + direction * 0.03)
    }

    this.post({ t: 'rate', rate: this._rate * this._nudgeFactor })
    this.updateKeyLockRouting()
    this.emit()
  }

  /**
   * Sync to another deck: matches tempo and aligns beat phase within the bar.
   */
  syncTo(other: DeckEngine): { pitch: number; barAligned: boolean } | null {
    const ownGrid = this.track?.grid ?? null
    const otherGrid = other.track?.grid ?? null
    const ownBpm = ownGrid?.bpm ?? this.track?.bpm
    const otherBpm = otherGrid?.bpm ?? other.track?.bpm
    if (!ownBpm || !otherBpm) return null

    let rate = (otherBpm * other.rate) / ownBpm
    while (rate > 1.5) rate /= 2
    while (rate < 0.66) rate *= 2
    this.setRate(rate)

    let barAligned = false
    if (ownGrid && otherGrid && this._playing && other.playing && !this._scratching) {
      const frame = Math.max(this.posFrame, other.lastPosFrame)
      const tSelf = this.positionAtFrame(frame)
      const tOther = other.positionAtFrame(frame)
      const ownBar = (60 / ownGrid.bpm) * ownGrid.beatsPerBar
      const otherBar = (60 / otherGrid.bpm) * otherGrid.beatsPerBar
      const phiSelf = positiveMod((tSelf - ownGrid.firstBar) / ownBar, 1)
      const phiOther = positiveMod((tOther - otherGrid.firstBar) / otherBar, 1)
      let dPhi = phiOther - phiSelf
      dPhi -= Math.round(dPhi)
      const shift = dPhi * ownBar
      this.post({ t: 'shift', s: shift })
      this.posSeconds = Math.min(Math.max(this.posSeconds + shift, 0), this.duration)
      barAligned = true
    }
    this.emit()
    return { pitch: (rate - 1) * 100, barAligned }
  }

  // ----- scratching (jog wheel) -----

  async scratchBegin() {
    if (!this.track) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this._scratching = true
    this.updateKeyLockRouting()
    this.post({ t: 'scratchOn' })
  }

  scratchMove(rate: number) {
    if (!this._scratching) return
    this.post({ t: 'scratchRate', rate })
  }

  scratchEnd() {
    if (!this._scratching) return
    this._scratching = false
    this.updateKeyLockRouting()
    this.post({ t: 'scratchOff' })
  }

  // ----- slip mode -----

  get slipMode() {
    return this._slipMode
  }

  setSlip(on: boolean) {
    this._slipMode = on
    this.post({ t: 'slip', on })
    this.emit()
  }

  // ----- FX -----

  get fxType() {
    return this._fxType
  }

  get fxWet() {
    return this._fxWet
  }

  get fxBeats() {
    return this._fxBeats
  }

  setFx(type: FxType) {
    this._fxType = type
    const t = this.ctx.currentTime
    if (type === 'reverb' && !this.reverb.buffer) {
      this.reverb.buffer = makeReverbImpulse(this.ctx)
    }
    this.echoSend.gain.setTargetAtTime(type === 'echo' ? 1 : 0, t, 0.02)
    this.echoFeedback.gain.setTargetAtTime(type === 'echo' ? 0.55 : 0, t, 0.02)
    this.reverbSend.gain.setTargetAtTime(type === 'reverb' ? 1 : 0, t, 0.02)
    this.flangerSend.gain.setTargetAtTime(type === 'flanger' ? 1 : 0, t, 0.02)
    this.flangerFeedback.gain.setTargetAtTime(type === 'flanger' ? 0.45 : 0, t, 0.02)
    this.applyFxWet()
    this.updateFxTiming()
    this.emit()
  }

  setFxWet(wet: number) {
    this._fxWet = wet
    this.applyFxWet()
    this.emit()
  }

  setFxBeats(beats: number) {
    this._fxBeats = beats
    this.updateFxTiming()
    this.emit()
  }

  private applyFxWet() {
    const t = this.ctx.currentTime
    this.echoWet.gain.setTargetAtTime(this._fxType === 'echo' ? this._fxWet : 0, t, 0.05)
    this.reverbWet.gain.setTargetAtTime(this._fxType === 'reverb' ? this._fxWet * 1.2 : 0, t, 0.05)
    this.flangerWet.gain.setTargetAtTime(this._fxType === 'flanger' ? this._fxWet : 0, t, 0.05)
  }

  private updateFxTiming() {
    const bpm = this.effectiveBpm ?? 120
    const seconds = Math.min(this._fxBeats * (60 / bpm), 2)
    this.echoDelay.delayTime.setTargetAtTime(seconds, this.ctx.currentTime, 0.05)
  }

  // ----- beatgrid snap helper -----

  snapToBeat(time: number): number {
    if (!this.track) return time
    const grid = this.track.grid
    const bpm = grid?.bpm ?? this.track.bpm
    if (!bpm || bpm <= 0) return time

    const beatLen = 60 / bpm
    const anchor = grid?.firstBeat ?? 0
    const beatIndex = Math.round((time - anchor) / beatLen)
    const snapped = anchor + beatIndex * beatLen
    return Math.max(0, Math.min(snapped, this.duration))
  }

  // ----- hot cues -----

  triggerHotCue(index: number) {
    if (!this.track) return
    const existing = this.hotCues[index]
    if (existing === null) {
      // Snap newly created cue to nearest beat if snap mode is enabled
      this.hotCues[index] = this.snapMode ? this.snapToBeat(this.position) : this.position
      this.emit()
      return
    }

    // Skipping to existing cue point
    if (!this._playing || !this.quantMode) {
      if (this.quantizeTimer) {
        window.clearTimeout(this.quantizeTimer)
        this.quantizeTimer = null
        this.pendingQuantizedCue = null
        this.pendingQuantizedIndex = null
      }
      this.seek(existing)
      if (!this._playing) void this.play()
      return
    }

    // QUANT MODE active during playback: beat-accurate skipping between cue points
    const grid = this.track.grid
    const bpm = grid?.bpm || this.effectiveBpm || this.track.bpm || 120
    const beatLen = 60 / bpm
    const anchor = grid?.firstBeat ?? 0
    const currentPos = this.position
    const elapsedInBeat = positiveMod(currentPos - anchor, beatLen)
    const timeUntilNextBeat = beatLen - elapsedInBeat

    // If clicked right on the beat (within 35ms of the beat onset), jump immediately in phase
    if (elapsedInBeat < 0.035) {
      if (this.quantizeTimer) {
        window.clearTimeout(this.quantizeTimer)
        this.quantizeTimer = null
        this.pendingQuantizedCue = null
        this.pendingQuantizedIndex = null
      }
      this.seek(existing + elapsedInBeat)
      return
    }

    // Otherwise, delay jump until the next beat boundary so it lands on beat
    if (this.quantizeTimer) {
      window.clearTimeout(this.quantizeTimer)
      this.quantizeTimer = null
    }
    this.pendingQuantizedCue = existing
    this.pendingQuantizedIndex = index
    this.emit()

    const delayMs = Math.max(10, Math.min(1000, (timeUntilNextBeat / this._rate) * 1000))
    this.quantizeTimer = window.setTimeout(() => {
      this.quantizeTimer = null
      const target = this.pendingQuantizedCue
      this.pendingQuantizedCue = null
      this.pendingQuantizedIndex = null
      if (target !== null && this._playing) {
        this.seek(target)
      }
      this.emit()
    }, delayMs)
  }

  clearHotCue(index: number) {
    if (this.pendingQuantizedIndex === index && this.quantizeTimer) {
      window.clearTimeout(this.quantizeTimer)
      this.quantizeTimer = null
      this.pendingQuantizedCue = null
      this.pendingQuantizedIndex = null
    }
    if (this.hotCues[index] !== null) {
      this.hotCues[index] = null
      this.emit()
    }
  }

  // ----- loops -----

  setBarLoop(bars: number) {
    if (!this.track) return
    const grid = this.track.grid
    const bpm = grid?.bpm ?? this.track.bpm ?? 120
    const beatsPerBar = grid?.beatsPerBar ?? 4
    const beatLen = 60 / bpm
    const barSec = beatLen * beatsPerBar
    const len = bars * barSec

    // Snap start to nearest beatgrid downbeat/beat if snap mode is enabled
    const start = this.snapMode ? this.snapToBeat(this.position) : this.position
    const end = Math.min(start + len, this.duration)
    this.loop = { start, end, bars }
    this.post({ t: 'loop', loop: this.loop })
    this.emit()
  }

  setLoop(start: number, end: number) {
    if (!this.track) return
    const snappedStart = this.snapMode ? this.snapToBeat(start) : start
    const snappedEnd = this.snapMode ? this.snapToBeat(end) : end
    const s = Math.max(0, Math.min(snappedStart, this.duration))
    const e = Math.max(s + 0.05, Math.min(snappedEnd > s ? snappedEnd : end, this.duration))
    this.loop = { start: s, end: e, bars: 0 }
    this.post({ t: 'loop', loop: this.loop })
    this.emit()
  }

  exitLoop() {
    this.clearLoop()
  }

  clearLoop() {
    this.loop = null
    this.post({ t: 'loop', loop: null })
    this.emit()
  }

  // ----- mixer channel controls -----

  private _gain = 1
  private _eqLow = 0
  private _eqMid = 0
  private _eqHigh = 0

  get gain(): number {
    return this._gain
  }

  setGain(v: number) {
    this._gain = v
    this.trim.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
    this.emit()
  }

  get eqLowGain(): number {
    return this._eqLow
  }

  get eqMidGain(): number {
    return this._eqMid
  }

  get eqHighGain(): number {
    return this._eqHigh
  }

  setEqLow(dB: number) {
    this._eqLow = dB
    this.eqLow.gain.setTargetAtTime(dB, this.ctx.currentTime, 0.01)
    this.emit()
  }

  setEqMid(dB: number) {
    this._eqMid = dB
    this.eqMid.gain.setTargetAtTime(dB, this.ctx.currentTime, 0.01)
    this.emit()
  }

  setEqHigh(dB: number) {
    this._eqHigh = dB
    this.eqHigh.gain.setTargetAtTime(dB, this.ctx.currentTime, 0.01)
    this.emit()
  }

  /**
   * Filter knob: -1 = full LPF (20Hz), 0 = off (bypass), +1 = full HPF (20kHz).
   */
  setFilter(norm: number) {
    const t = this.ctx.currentTime
    if (Math.abs(norm) < 0.02) {
      this.filter.type = 'allpass'
      this.filter.frequency.setTargetAtTime(1000, t, 0.01)
    } else if (norm < 0) {
      this.filter.type = 'lowpass'
      const f = 20 * Math.pow(20000 / 20, 1 + norm)
      this.filter.frequency.setTargetAtTime(f, t, 0.01)
      this.filter.Q.setTargetAtTime(1.2, t, 0.01)
    } else {
      this.filter.type = 'highpass'
      const f = 20 * Math.pow(20000 / 20, norm)
      this.filter.frequency.setTargetAtTime(f, t, 0.01)
      this.filter.Q.setTargetAtTime(1.2, t, 0.01)
    }
  }

  setVolume(vol: number) {
    // Volume fader: squared curve for natural fader taper
    this.fader.gain.setTargetAtTime(vol * vol, this.ctx.currentTime, 0.01)
  }

  setCrossfadeGain(gain: number) {
    this.xfade.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01)
  }
}

function makeReverbImpulse(ctx: AudioContext, seconds = 2.2, decay = 2.8): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(2, len, rate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}
