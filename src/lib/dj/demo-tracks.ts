import { computeAutoGain } from './autogain'
import { computePeaks } from './peaks'
import type { Track } from './types'

/**
 * Synthesizes royalty-free demo tracks entirely in the browser using OfflineAudioContext.
 */

type SectionKind = 'intro' | 'main' | 'peak'

interface DemoSpec {
  id: string
  title: string
  artist: string
  bpm: number
  keyName: string
  camelot: string
  root: number // bass root frequency (Hz)
  style: 'techno' | 'house'
}

const DEMOS: DemoSpec[] = [
  {
    id: 'demo-neon-circuit',
    title: 'Neon Circuit',
    artist: 'KeyBPM Demo',
    bpm: 124,
    keyName: 'A minor',
    camelot: '8A',
    root: 55,
    style: 'techno',
  },
  {
    id: 'demo-velvet-hours',
    title: 'Velvet Hours',
    artist: 'KeyBPM Demo',
    bpm: 118,
    keyName: 'F minor',
    camelot: '4A',
    root: 43.65,
    style: 'house',
  },
]

const SECTION_BARS = 4
const SAMPLE_RATE = 44100

export async function createDemoTracks(): Promise<Track[]> {
  const tracks: Track[] = []
  for (const spec of DEMOS) {
    const buffer = await renderDemo(spec)
    tracks.push({
      id: spec.id,
      title: spec.title,
      artist: spec.artist,
      duration: buffer.duration,
      bpm: spec.bpm,
      grid: { bpm: spec.bpm, firstBeat: 0, firstBar: 0, beatsPerBar: 4 },
      key: { name: spec.keyName, camelot: spec.camelot },
      // Normalised like any other track. Hardcoding 1 here meant the demo decks
      // did not match each other or anything else at the same fader position.
      gain: computeAutoGain(buffer),
      buffer,
      peaks: computePeaks(buffer),
    })
  }
  return tracks
}

async function renderDemo(spec: DemoSpec): Promise<AudioBuffer> {
  const intro = await renderSection(spec, 'intro')
  const main = await renderSection(spec, 'main')
  const peak = await renderSection(spec, 'peak')

  // 32 bars total: intro, main, main, peak, peak, main, peak, intro
  const arrangement = [intro, main, main, peak, peak, main, peak, intro]
  const sectionLength = intro.length
  const out = new AudioBuffer({
    numberOfChannels: 2,
    length: sectionLength * arrangement.length,
    sampleRate: SAMPLE_RATE,
  })
  arrangement.forEach((section, i) => {
    for (let ch = 0; ch < 2; ch++) {
      out.getChannelData(ch).set(section.getChannelData(ch), i * sectionLength)
    }
  })
  return out
}

function renderSection(spec: DemoSpec, kind: SectionKind): Promise<AudioBuffer> {
  const beat = 60 / spec.bpm
  const totalBeats = SECTION_BARS * 4
  const length = Math.round(totalBeats * beat * SAMPLE_RATE)
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE)

  const master = ctx.createGain()
  master.gain.value = 0.8
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -8
  limiter.ratio.value = 12
  master.connect(limiter)
  limiter.connect(ctx.destination)

  const noise = makeNoiseBuffer(ctx, 1)

  for (let b = 0; b < totalBeats; b++) {
    const t = b * beat
    const beatInBar = b % 4

    kick(ctx, master, t)
    if (beatInBar === 1 || beatInBar === 3) clap(ctx, master, noise, t)

    if (kind !== 'intro') {
      hat(ctx, master, noise, t + beat / 2, 0.18)
      const pattern =
        spec.style === 'techno' ? [1, 0, 1, 0.5, 1, 0, 1.5, 0.5] : [1, 1, 0, 1, 0.5, 0, 1.5, 1]
      for (let s = 0; s < 8; s++) {
        const mult = pattern[(b * 8 + s) % pattern.length]
        if (mult === 0) continue
        bass(ctx, master, t + (s * beat) / 8 + beat / 16, beat / 10, spec.root * mult, spec.style)
      }
    }

    if (kind === 'peak') {
      hat(ctx, master, noise, t + beat / 4, 0.07)
      hat(ctx, master, noise, t + (3 * beat) / 4, 0.07)
      if (b % 8 === 2) stab(ctx, master, t + beat / 2, spec.root * 4, spec.style)
    }
  }

  return ctx.startRendering()
}

function makeNoiseBuffer(ctx: OfflineAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function kick(ctx: OfflineAudioContext, out: AudioNode, t: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, t)
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.11)
  gain.gain.setValueAtTime(1, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28)
  osc.connect(gain)
  gain.connect(out)
  osc.start(t)
  osc.stop(t + 0.3)
}

function hat(ctx: OfflineAudioContext, out: AudioNode, noise: AudioBuffer, t: number, level: number) {
  const src = ctx.createBufferSource()
  src.buffer = noise
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 8000
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(level, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
  src.connect(hp)
  hp.connect(gain)
  gain.connect(out)
  src.start(t, Math.random() * 0.5, 0.06)
}

function clap(ctx: OfflineAudioContext, out: AudioNode, noise: AudioBuffer, t: number) {
  const src = ctx.createBufferSource()
  src.buffer = noise
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1500
  bp.Q.value = 1.2
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(0.4, t + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
  src.connect(bp)
  bp.connect(gain)
  gain.connect(out)
  src.start(t, Math.random() * 0.5, 0.16)
}

function bass(
  ctx: OfflineAudioContext,
  out: AudioNode,
  t: number,
  length: number,
  freq: number,
  style: 'techno' | 'house'
) {
  const osc = ctx.createOscillator()
  osc.type = style === 'techno' ? 'sawtooth' : 'triangle'
  osc.frequency.value = freq
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = style === 'techno' ? 420 : 600
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(0.32, t + 0.01)
  gain.gain.setValueAtTime(0.32, t + length)
  gain.gain.exponentialRampToValueAtTime(0.001, t + length + 0.05)
  osc.connect(lp)
  lp.connect(gain)
  gain.connect(out)
  osc.start(t)
  osc.stop(t + length + 0.1)
}

function stab(
  ctx: OfflineAudioContext,
  out: AudioNode,
  t: number,
  root: number,
  style: 'techno' | 'house'
) {
  const ratios = style === 'techno' ? [1, 1.1892, 1.4983] : [1, 1.2599, 1.4983]
  for (const r of ratios) {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = root * r
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(2400, t)
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.22)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.09, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    osc.connect(lp)
    lp.connect(gain)
    gain.connect(out)
    osc.start(t)
    osc.stop(t + 0.3)
  }
}
