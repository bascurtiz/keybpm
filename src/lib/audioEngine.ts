/**
 * Web Audio metronome + scale/drone/sample playback
 * (ported from key-tool-online, KeyBPM-styled UI separately).
 */

export type WaveType = 'triangle' | 'sine' | 'sawtooth' | 'piano' | 'guitar'

export interface ScaleNoteInfo {
  freq: number | number[]
  noteName?: string
  volume?: number
}

export class AudioEngine {
  private audioCtx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private isPlaying = false
  private lookahead = 25
  private scheduleAheadTime = 0.1
  private nextNoteTime = 0
  private timerID: ReturnType<typeof setTimeout> | null = null
  private bpm = 120
  private current16thNote = 0
  private muteClick = false
  private scaleQueue: ScaleNoteInfo[] = []
  private scaleNoteIndex = 0
  private isPlayingScale = false
  private scaleFinishTimer: ReturnType<typeof setTimeout> | null = null
  private pendingScaleQueue: ScaleNoteInfo[] | null = null
  private volume = 0.5
  private detune = 0
  private waveType: WaveType = 'triangle'
  private onNotePlayed: ((info: ScaleNoteInfo) => void) | null
  private droneOsc: OscillatorNode | null = null
  private droneGain: GainNode | null = null
  private sampleBuffers: Record<string, AudioBuffer> = {}
  private samplesLoaded = false
  onBeat: ((beat: number) => void) | null = null

  constructor(onNotePlayed?: (info: ScaleNoteInfo) => void) {
    this.onNotePlayed = onNotePlayed ?? null
  }

  init(): void {
    if (this.audioCtx) return
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.audioCtx = new Ctx()
    this.masterGain = this.audioCtx.createGain()
    this.masterGain.gain.value = this.volume
    this.masterGain.connect(this.audioCtx.destination)
    void this.loadSamples()
  }

  private async loadSamples(): Promise<void> {
    if (!this.audioCtx) return
    const instruments = ['piano', 'guitar'] as const
    const octaves = [2, 3, 4, 5, 6]
    const base = `${import.meta.env.BASE_URL}sounds/`
    await Promise.all(
      instruments.flatMap(instrument =>
        octaves.map(async octave => {
          const name = `${instrument}-C${octave}`
          try {
            const res = await fetch(`${base}${name}.audio`)
            if (!res.ok) return
            const buf = await this.audioCtx!.decodeAudioData(await res.arrayBuffer())
            this.sampleBuffers[name] = buf
          } catch {
            /* optional samples */
          }
        }),
      ),
    )
    this.samplesLoaded = Object.keys(this.sampleBuffers).length > 0
  }

  async resume(): Promise<void> {
    this.init()
    if (this.audioCtx?.state === 'suspended') await this.audioCtx.resume()
  }

  setBpm(bpm: number): void {
    this.bpm = bpm
  }

  setVolume(val: number): void {
    this.volume = val
    if (this.masterGain) this.masterGain.gain.value = val
  }

  setDetune(cents: number): void {
    this.detune = cents
  }

  setWaveType(type: WaveType): void {
    this.waveType = type
  }

  get playing(): boolean {
    return this.isPlaying
  }

  get playingScale(): boolean {
    return this.isPlayingScale
  }

  start(): void {
    if (this.isPlaying) return
    this.init()
    void this.resume()
    this.isPlaying = true
    this.current16thNote = 0
    this.nextNoteTime = this.audioCtx!.currentTime
    this.scheduler()
  }

  stop(): void {
    this.isPlaying = false
    this.isPlayingScale = false
    this.muteClick = false
    this.pendingScaleQueue = null
    this.stopDrone()
    if (this.timerID) clearTimeout(this.timerID)
    this.timerID = null
    if (this.scaleFinishTimer) clearTimeout(this.scaleFinishTimer)
    this.scaleFinishTimer = null
  }

  /** Alias used by Guided Mode vibe patterns. */
  playPattern(notes: ScaleNoteInfo[], _bpm?: number, sync = false): void {
    this.playScale(notes, sync)
  }

  playScale(notesWithInfo: ScaleNoteInfo[], syncToDownbeat = false): void {
    if (syncToDownbeat && this.isPlaying) {
      this.pendingScaleQueue = notesWithInfo
      this.muteClick = true
      return
    }
    this.scaleQueue = notesWithInfo
    this.scaleNoteIndex = 0
    this.isPlayingScale = true
    this.muteClick = true
    if (this.scaleFinishTimer) {
      clearTimeout(this.scaleFinishTimer)
      this.scaleFinishTimer = null
    }
    if (this.isPlaying) {
      this.nextNoteTime = this.audioCtx!.currentTime
      this.current16thNote = 0
    } else {
      this.start()
    }
  }

  stopScale(): void {
    this.isPlayingScale = false
    this.muteClick = false
    this.pendingScaleQueue = null
    if (this.scaleFinishTimer) {
      clearTimeout(this.scaleFinishTimer)
      this.scaleFinishTimer = null
    }
  }

  playDrone(freq: number): void {
    this.init()
    void this.resume()
    this.stopDrone()
    const ctx = this.audioCtx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    osc.detune.value = this.detune
    filter.type = 'lowpass'
    filter.frequency.value = freq * 2
    osc.connect(filter)
    filter.connect(gain)
    gain.connect(this.masterGain!)
    osc.start()
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.1)
    this.droneOsc = osc
    this.droneGain = gain
  }

  stopDrone(): void {
    if (!this.droneOsc || !this.droneGain || !this.audioCtx) return
    const now = this.audioCtx.currentTime
    this.droneGain.gain.cancelScheduledValues(now)
    this.droneGain.gain.setValueAtTime(Math.max(this.droneGain.gain.value, 0.001), now)
    this.droneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
    this.droneOsc.stop(now + 0.2)
    this.droneOsc = null
    this.droneGain = null
  }

  private nextNote(): void {
    const secondsPerBeat = 60.0 / this.bpm
    this.nextNoteTime += 0.25 * secondsPerBeat
    this.current16thNote++
    if (this.current16thNote === 16) this.current16thNote = 0
  }

  private scheduleNote(beatNumber: number, time: number): void {
    if (beatNumber % 4 !== 0) return
    if (!this.muteClick) this.playClick(time, beatNumber === 0)
    if (this.onBeat) {
      const beat = beatNumber / 4
      const delay = (time - this.audioCtx!.currentTime) * 1000
      setTimeout(() => {
        if (this.isPlaying) this.onBeat?.(beat)
      }, Math.max(0, delay))
    }

    if (beatNumber === 0 && this.pendingScaleQueue) {
      this.scaleQueue = this.pendingScaleQueue
      this.pendingScaleQueue = null
      this.scaleNoteIndex = 0
      this.isPlayingScale = true
      this.muteClick = true
    }

    if (this.isPlayingScale && this.scaleNoteIndex < this.scaleQueue.length) {
      const noteInfo = this.scaleQueue[this.scaleNoteIndex]
      const duration = 1.5
      const vol = noteInfo.volume ?? 1
      if (Array.isArray(noteInfo.freq)) this.playChord(noteInfo.freq, time, duration, vol)
      else this.playTone(noteInfo.freq, time, duration, vol)
      if (this.onNotePlayed) {
        const delay = (time - this.audioCtx!.currentTime) * 1000
        setTimeout(() => {
          if (this.isPlayingScale) this.onNotePlayed?.(noteInfo)
        }, Math.max(0, delay))
      }
      this.scaleNoteIndex++
    } else if (this.isPlayingScale && this.scaleNoteIndex >= this.scaleQueue.length && !this.scaleFinishTimer) {
      const secondsPerBeat = 60.0 / this.bpm
      this.scaleFinishTimer = setTimeout(() => {
        this.isPlayingScale = false
        this.muteClick = false
        this.scaleFinishTimer = null
      }, (time - this.audioCtx!.currentTime + secondsPerBeat) * 1000)
    }
  }

  private playClick(time: number, isAccent: boolean): void {
    if (!this.audioCtx || !this.masterGain) return
    const osc = this.audioCtx.createOscillator()
    const gain = this.audioCtx.createGain()
    osc.connect(gain)
    gain.connect(this.masterGain)
    osc.frequency.value = isAccent ? 1500 : 1000
    gain.gain.value = isAccent ? 0.7 : 0.5
    osc.start(time)
    osc.stop(time + 0.05)
  }

  private getNearestSample(instrument: string, freq: number) {
    const midiNote = 12 * Math.log2(freq / 440) + 69
    const cNotes = [36, 48, 60, 72, 84]
    const octaves = [2, 3, 4, 5, 6]
    let nearest = 0
    let minDiff = Math.abs(midiNote - cNotes[0])
    for (let i = 1; i < cNotes.length; i++) {
      const d = Math.abs(midiNote - cNotes[i])
      if (d < minDiff) {
        minDiff = d
        nearest = i
      }
    }
    return {
      sampleName: `${instrument}-C${octaves[nearest]}`,
      detune: (midiNote - cNotes[nearest]) * 100,
    }
  }

  private playSampleTone(instrument: string, freq: number, time: number, volumeMultiplier: number): void {
    if (!this.audioCtx || !this.masterGain || !this.samplesLoaded) return
    const { sampleName, detune } = this.getNearestSample(instrument, freq)
    const buffer = this.sampleBuffers[sampleName]
    if (!buffer) return
    const source = this.audioCtx.createBufferSource()
    source.buffer = buffer
    source.detune.value = detune + this.detune
    const gain = this.audioCtx.createGain()
    source.connect(gain)
    gain.connect(this.masterGain)
    const playDuration = 6
    const peak = 0.8 * volumeMultiplier
    gain.gain.setValueAtTime(peak, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + playDuration)
    source.start(time)
    source.stop(time + playDuration)
  }

  playTone(freq: number, time: number, duration: number, volumeMultiplier = 1): void {
    if (!this.audioCtx || !this.masterGain) this.init()
    if (this.waveType === 'piano' || this.waveType === 'guitar') {
      this.playSampleTone(this.waveType, freq, time, volumeMultiplier)
      return
    }
    const ctx = this.audioCtx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    osc.type = this.waveType
    osc.frequency.value = freq
    osc.detune.value = this.detune
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(freq * 4, time)
    filter.frequency.exponentialRampToValueAtTime(freq, time + 0.5)
    osc.connect(filter)
    filter.connect(gain)
    gain.connect(this.masterGain!)
    osc.start(time)
    osc.stop(time + duration)
    const peak = 0.6 * volumeMultiplier
    gain.gain.setValueAtTime(0, time)
    gain.gain.linearRampToValueAtTime(peak, time + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration)
  }

  playChord(frequencies: number[], time: number, duration: number, volumeMultiplier = 1): void {
    for (const freq of frequencies) this.playTone(freq, time, duration, volumeMultiplier)
  }

  /** Immediate one-shot (piano key / note list click). */
  playNow(freq: number | number[], duration = 1.2): void {
    this.init()
    void this.resume()
    const t = this.audioCtx!.currentTime
    if (Array.isArray(freq)) this.playChord(freq, t, duration)
    else this.playTone(freq, t, duration)
  }

  private scheduler(): void {
    if (!this.audioCtx) return
    while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
      this.scheduleNote(this.current16thNote, this.nextNoteTime)
      this.nextNote()
    }
    if (this.isPlaying) {
      this.timerID = setTimeout(() => this.scheduler(), this.lookahead)
    }
  }
}
