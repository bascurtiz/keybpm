/**
 * Offline mix renderer.
 *
 * Rebuilds a captured performance in an `OfflineAudioContext` and writes it out
 * as a WAV file. Rendering offline buys three things that a realtime capture
 * cannot: keylock segments go through the non-realtime stretcher with longer
 * WSOLA windows and an exhaustive seek search; nothing is ever under-run, so the
 * mix is not fighting the audio thread; and the output is uncompressed PCM rather
 * than whatever Opus bitrate the browser picked.
 *
 * The signal path mirrors `DeckEngine` node for node — track gain, channel
 * fader, three-band EQ, filter, deck volume, crossfader, master gain, brickwall
 * limiter — so the render sounds like the performance. The one structural
 * difference is the filter: the live graph flips a single biquad's type when the
 * knob crosses zero, which an offline render cannot do mid-render, so the filter
 * is a parallel low-pass/high-pass/all-pass bank whose branch gains are
 * automated instead. That also removes the click a live type flip can produce.
 */
import { encodeWav, type WavBitDepth } from './wav'
import {
  pitchShiftHoldFrames,
  pitchShiftTo,
  planarSink,
  timeStretchTo,
  stretchHoldFrames,
  type PlanarSource,
} from './offline-stretch'
import {
  isRubberBandAvailable,
  rubberBandHoldFrames,
  rubberBandTimeStretchTo,
} from './rubberband-offline'
import type { DeckControlPoint, MixTimeline, RenderSegment } from './mix-timeline'
import type { DeckId } from './types'

/** Limiter settings shared with the live `AudioEngine` so renders match playback. */
export const LIMITER_SETTINGS = {
  threshold: -1.5,
  knee: 0,
  ratio: 20,
  attack: 0.002,
  release: 0.25,
} as const

/** Crossfade into a segment's neighbours, and between filter modes. */
const SEGMENT_FADE_SECONDS = 0.006
const FILTER_MODE_FADE_SECONDS = 0.008

/** Below this a segment is silence with extra steps; above it, always render. */
const MIN_RENDERABLE_SEGMENT = 0.02

/** Below this a rendered mix counts as starting in silence and is trimmed. */
const SILENCE_TRIM_THRESHOLD = 0.002

/** Speed within this of 1.0 needs no stretching at all. */
const IDENTITY_SPEED_TOLERANCE = 0.0005

export interface MixRenderProgress {
  phase: 'measuring' | 'stretching' | 'mixing' | 'encoding' | 'done'
  /** Segment currently being stretched, 1-based, when in the stretching phase. */
  segment?: number
  segmentCount?: number
  deck?: DeckId
  /** Progress inside the current segment, 0..1. */
  ratio?: number
}

/**
 * Which non-realtime stretcher renders keylocked segments.
 *
 *  - `rubberband`: Rubber Band R3, formant-aware and phase-coherent; measured
 *    alignment error +0.1 to +1.0 ms at speeds 1.0-1.25, at ~1/3 of realtime.
 *  - `soundtouch`: the SoundTouch core's WSOLA stage, ~1/16 of realtime, with
 *    frames inside a segment wandering up to half a seek window.
 *  - `auto` (default): Rubber Band when its engine can be loaded, SoundTouch
 *    otherwise, so a render never fails for want of an optional engine.
 */
export type MixStretchEngine = 'auto' | 'rubberband' | 'soundtouch'

export interface MixRenderOptions {
  bitDepth?: WavBitDepth
  stretchEngine?: MixStretchEngine
  onProgress?: (progress: MixRenderProgress) => void
}

export interface RenderedMix {
  blob: Blob
  duration: number
  frames: number
  sampleRate: number
  bitDepth: WavBitDepth
  /** Keylock segments that went through the non-realtime stretcher. */
  stretchedSegments: number
  /** Realtime-resampled segments (keylock off, or speed at 1.0). */
  directSegments: number
  /** Leading silence removed from the render, in milliseconds. */
  trimmedMs: number
  /** Stretcher that actually rendered the keylocked segments. */
  stretchEngine: 'rubberband' | 'soundtouch'
}

interface DeckChain {
  trim: GainNode
  eqLow: BiquadFilterNode
  eqMid: BiquadFilterNode
  eqHigh: BiquadFilterNode
  filterLow: BiquadFilterNode
  filterHigh: BiquadFilterNode
  filterAll: BiquadFilterNode
  filterLowGain: GainNode
  filterHighGain: GainNode
  filterAllGain: GainNode
  fader: GainNode
  xfade: GainNode
}

/**
 * Renders a captured mix.
 *
 * Stretching is the slow phase and is done segment by segment, yielding to the
 * event loop as it goes, so the UI keeps painting a progress bar instead of
 * freezing.
 */
export async function renderMix(
  timeline: MixTimeline,
  options: MixRenderOptions = {}
): Promise<RenderedMix> {
  const report = (progress: MixRenderProgress) => options.onProgress?.(progress)
  const sampleRate = timeline.sampleRate
  const bitDepth = options.bitDepth ?? 24
  const totalSegments = timeline.decks.A.segments.length + timeline.decks.B.segments.length

  if (totalSegments === 0) throw new Error('nothing to render: no deck played while recording')

  const requestedEngine = options.stretchEngine ?? 'auto'
  const engine: 'rubberband' | 'soundtouch' =
    requestedEngine === 'soundtouch'
      ? 'soundtouch'
      : await isRubberBandAvailable()
        ? 'rubberband'
        : 'soundtouch'

  report({ phase: 'measuring' })
  const duration = Math.max(0.1, timeline.duration)
  const frames = Math.ceil(duration * sampleRate) + Math.ceil(sampleRate * 0.25)
  const ctx = new OfflineAudioContext(2, frames, sampleRate)

  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = LIMITER_SETTINGS.threshold
  limiter.knee.value = LIMITER_SETTINGS.knee
  limiter.ratio.value = LIMITER_SETTINGS.ratio
  limiter.attack.value = LIMITER_SETTINGS.attack
  limiter.release.value = LIMITER_SETTINGS.release

  const master = ctx.createGain()
  master.gain.value = 0
  master.connect(limiter)
  limiter.connect(ctx.destination)

  const decks = {} as Record<DeckId, DeckChain>
  for (const id of ['A', 'B'] as DeckId[]) decks[id] = createDeckChain(ctx, master)

  automateMaster(master, decks, timeline)

  let stretchedSegments = 0
  let directSegments = 0
  let segmentNumber = 0
  let usedEngine: 'rubberband' | 'soundtouch' = engine

  for (const id of ['A', 'B'] as DeckId[]) {
    const deck = timeline.decks[id]
    automateDeck(decks[id], deck.controls)

    for (const segment of deck.segments) {
      segmentNumber++
      if (segment.duration < MIN_RENDERABLE_SEGMENT) continue
      const ref = deck.tracks[segment.trackIndex]
      if (!ref) continue

      const available = Math.max(0, ref.buffer.duration - segment.sourceStart)
      if (available <= 0.001) continue

      const keyLocked = segment.keyLock && Math.abs(segment.speed - 1) > IDENTITY_SPEED_TOLERANCE
      const playSeconds = Math.min(segment.duration, available / segment.speed)
      if (playSeconds <= 0.001) continue

      if (!keyLocked) {
        // Keylock off is pure resampling, and an AudioBufferSourceNode already
        // does that natively (and well) at the segment's speed.
        const source = ctx.createBufferSource()
        source.buffer = ref.buffer
        source.playbackRate.value = segment.speed
        const envelope = segmentEnvelope(ctx, segment.start, playSeconds, ref.gain)
        source.connect(envelope)
        envelope.connect(decks[id].trim)
        source.start(segment.start, segment.sourceStart, Math.min(available, playSeconds * segment.speed))
        directSegments++
        continue
      }

      report({
        phase: 'stretching',
        deck: id,
        segment: segmentNumber,
        segmentCount: totalSegments,
        ratio: 0,
      })
      const rendered = await stretchSegment(ctx, segment, ref.buffer, engine, ratio =>
        report({
          phase: 'stretching',
          deck: id,
          segment: segmentNumber,
          segmentCount: totalSegments,
          ratio,
        })
      )
      const source = ctx.createBufferSource()
      source.buffer = rendered.buffer
      if (rendered.engine !== engine) usedEngine = rendered.engine
      const envelope = segmentEnvelope(ctx, segment.start, playSeconds, ref.gain)
      source.connect(envelope)
      envelope.connect(decks[id].trim)
      source.start(segment.start, 0, playSeconds)
      stretchedSegments++
    }
  }

  report({ phase: 'mixing' })
  const mixed = await ctx.startRendering()

  report({ phase: 'encoding' })
  const trimFrames = leadingSilenceFrames(mixed)
  const trimmed =
    trimFrames > 0 ? sliceBuffer(ctx, mixed, trimFrames, mixed.length - trimFrames) : mixed
  const blob = encodeWav(trimmed, { bitDepth })

  report({ phase: 'done' })
  return {
    blob,
    duration: trimmed.length / trimmed.sampleRate,
    frames: trimmed.length,
    sampleRate: trimmed.sampleRate,
    bitDepth,
    stretchedSegments,
    directSegments,
    trimmedMs: (trimFrames / sampleRate) * 1000,
    stretchEngine: usedEngine,
  }
}

/** Channel strip mirroring `DeckEngine`'s node order. */
function createDeckChain(ctx: OfflineAudioContext, master: GainNode): DeckChain {
  const trim = ctx.createGain()
  const eqLow = ctx.createBiquadFilter()
  eqLow.type = 'lowshelf'
  eqLow.frequency.value = 320
  const eqMid = ctx.createBiquadFilter()
  eqMid.type = 'peaking'
  eqMid.frequency.value = 1000
  eqMid.Q.value = 0.9
  const eqHigh = ctx.createBiquadFilter()
  eqHigh.type = 'highshelf'
  eqHigh.frequency.value = 3200

  const makeBranch = (type: BiquadFilterType) => {
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = 1000
    filter.Q.value = 1.2
    return filter
  }
  const filterLow = makeBranch('lowpass')
  const filterHigh = makeBranch('highpass')
  const filterAll = makeBranch('allpass')
  const filterLowGain = ctx.createGain()
  const filterHighGain = ctx.createGain()
  const filterAllGain = ctx.createGain()
  filterLowGain.gain.value = 0
  filterHighGain.gain.value = 0
  filterAllGain.gain.value = 1

  const fader = ctx.createGain()
  const xfade = ctx.createGain()
  xfade.gain.value = 1

  trim.connect(eqLow)
  eqLow.connect(eqMid)
  eqMid.connect(eqHigh)
  eqHigh.connect(filterLow)
  eqHigh.connect(filterHigh)
  eqHigh.connect(filterAll)
  filterLow.connect(filterLowGain)
  filterHigh.connect(filterHighGain)
  filterAll.connect(filterAllGain)
  filterLowGain.connect(fader)
  filterHighGain.connect(fader)
  filterAllGain.connect(fader)
  fader.connect(xfade)
  xfade.connect(master)

  return {
    trim,
    eqLow,
    eqMid,
    eqHigh,
    filterLow,
    filterHigh,
    filterAll,
    filterLowGain,
    filterHighGain,
    filterAllGain,
    fader,
    xfade,
  }
}

/** Schedules the channel fader, EQ and filter from captured control points. */
function automateDeck(chain: DeckChain, controls: DeckControlPoint[]): void {
  if (controls.length === 0) return
  const times = controls.map(point => point.t)
  ramp(chain.trim.gain, controls.map(point => point.gain), times)
  ramp(chain.eqLow.gain, controls.map(point => point.eqLow), times)
  ramp(chain.eqMid.gain, controls.map(point => point.eqMid), times)
  ramp(chain.eqHigh.gain, controls.map(point => point.eqHigh), times)

  // Filter: the knob value picks the branch, and the branch gains crossfade.
  const lowGain: number[] = []
  const highGain: number[] = []
  const allGain: number[] = []
  const lowFreq: number[] = []
  const highFreq: number[] = []
  for (const point of controls) {
    const value = point.filter
    const bypassed = Math.abs(value) < 0.02
    lowGain.push(!bypassed && value < 0 ? 1 : 0)
    highGain.push(!bypassed && value > 0 ? 1 : 0)
    allGain.push(bypassed ? 1 : 0)
    lowFreq.push(20 * Math.pow(20000 / 20, 1 + Math.min(0, value)))
    highFreq.push(20 * Math.pow(20000 / 20, Math.max(0, value)))
  }
  const modeTimes = spread(times, FILTER_MODE_FADE_SECONDS)
  ramp(chain.filterLowGain.gain, lowGain, times)
  ramp(chain.filterHighGain.gain, highGain, times)
  ramp(chain.filterAllGain.gain, allGain, times)
  ramp(chain.filterLow.frequency, lowFreq, modeTimes)
  ramp(chain.filterHigh.frequency, highFreq, modeTimes)
}

/** Master gain and the crossfader, using the live engine's fader law. */
function automateMaster(
  master: GainNode,
  decks: Record<DeckId, DeckChain>,
  timeline: MixTimeline
): void {
  const points = timeline.master
  if (points.length === 0) {
    master.gain.value = 0.81
    return
  }
  const times = points.map(point => point.t)
  ramp(
    master.gain,
    points.map(point => point.volume * point.volume),
    times
  )
  ramp(
    decks.A.xfade.gain,
    points.map(point => Math.cos((Math.max(0, point.crossfade) * Math.PI) / 2)),
    times
  )
  ramp(
    decks.B.xfade.gain,
    points.map(point => Math.cos((Math.max(0, -point.crossfade) * Math.PI) / 2)),
    times
  )
}

function ramp(param: AudioParam, values: number[], times: number[]): void {
  if (values.length === 0) return
  param.setValueAtTime(values[0], times[0])
  for (let i = 1; i < values.length; i++) {
    param.linearRampToValueAtTime(values[i], Math.max(times[i], times[i - 1]))
  }
}

/** Shifts times back slightly so automation lands just before each capture tick. */
function spread(times: number[], lead: number): number[] {
  return times.map(time => Math.max(0, time - lead))
}

/**
 * Per-segment gain node carrying the track's own gain, with short fades so a
 * butt-joined seam cannot click.
 */
function segmentEnvelope(
  ctx: OfflineAudioContext,
  start: number,
  duration: number,
  peak: number
): GainNode {
  const gain = ctx.createGain()
  const fade = Math.min(SEGMENT_FADE_SECONDS, duration / 4)
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(peak, start + fade)
  gain.gain.setValueAtTime(peak, start + duration - fade)
  gain.gain.linearRampToValueAtTime(0, start + duration)
  return gain
}

/**
 * Renders one keylocked segment through the non-realtime stretcher.
 *
 * The read window is extended past the segment by however many frames the
 * pipeline holds back, so the segment's own tail is complete; the extra output
 * is never scheduled, and never heard.
 */
async function stretchSegment(
  ctx: OfflineAudioContext,
  segment: RenderSegment,
  source: AudioBuffer,
  engine: 'rubberband' | 'soundtouch',
  onRatio: (ratio: number) => void
): Promise<{ buffer: AudioBuffer; engine: 'rubberband' | 'soundtouch' }> {
  // Everything here happens in the *track's* sample rate. The stretcher is pure
  // sample arithmetic, and an AudioBufferSourceNode resamples to the mix context
  // natively, so a 44.1 kHz file dropped into a 48 kHz mix keeps its tempo and
  // its pitch instead of being played as if it were already context-rate.
  const rate = source.sampleRate
  const available = Math.max(0, source.duration - segment.sourceStart)
  const wanted = segment.duration * segment.speed
  const shift = Math.round(segment.keyShift)
  const holdFrames =
    engine === 'rubberband'
      ? rubberBandHoldFrames(rate, segment.speed, shift)
      : stretchHoldFrames(rate, segment.speed) + (shift !== 0 ? pitchShiftHoldFrames(rate, shift) : 0)
  const readSeconds = Math.min(available, wanted + holdFrames / rate)
  const readFrames = Math.max(1, Math.ceil(readSeconds * rate))
  const startFrame = Math.round(segment.sourceStart * rate)

  let plane: PlanarSource = {
    left: source.getChannelData(0),
    right: source.numberOfChannels > 1 ? source.getChannelData(1) : source.getChannelData(0),
    offset: startFrame,
    frames: readFrames,
  }

  // Rubber Band handles pitch and tempo in one pass, so it gets the shift as an
  // argument instead of a separate resynthesis stage.
  if (engine === 'rubberband') {
    const outputFrames = Math.ceil(readFrames / segment.speed) + 64
    const buffer = ctx.createBuffer(2, outputFrames, rate)
    const total = plane.frames
    const written = await rubberBandTimeStretchTo(
      planarSink(buffer.getChannelData(0), buffer.getChannelData(1), outputFrames),
      plane,
      rate,
      segment.speed,
      {
        semitones: shift,
        yieldEveryBlocks: 64,
        onProgress: framesDone => onRatio(total > 0 ? framesDone / total : 1),
      }
    )
    if (written !== null) return { buffer, engine: 'rubberband' }
    // Engine vanished mid-render: finish this segment the guaranteed way.
  }

  // Key shift is pitch-only, so it runs first and keeps its input's length; the
  // tempo stretch after it then lands on the segment's true speed.
  if (shift !== 0) {
    const shiftedLeft = new Float32Array(readFrames + 64)
    const shiftedRight = new Float32Array(readFrames + 64)
    await pitchShiftTo(
      planarSink(shiftedLeft, shiftedRight, shiftedLeft.length),
      plane,
      rate,
      shift
    )
    plane = { left: shiftedLeft, right: shiftedRight, offset: 0, frames: readFrames }
  }

  const outputFrames = Math.ceil(readFrames / segment.speed) + 64
  const buffer = ctx.createBuffer(2, outputFrames, rate)
  const total = plane.frames
  await timeStretchTo(
    planarSink(buffer.getChannelData(0), buffer.getChannelData(1), outputFrames),
    plane,
    rate,
    segment.speed,
    undefined,
    {
      yieldEveryFrames: Math.max(rate, rate * 2),
      onProgress: framesDone => onRatio(total > 0 ? framesDone / total : 1),
    }
  )
  return { buffer, engine: 'soundtouch' }
}

/** First frame above the silence threshold, or 0 when the mix starts with audio. */
function leadingSilenceFrames(buffer: AudioBuffer): number {
  const left = buffer.getChannelData(0)
  for (let i = 0; i < left.length; i++) {
    if (Math.abs(left[i]) > SILENCE_TRIM_THRESHOLD) return i
  }
  return 0
}

function sliceBuffer(
  ctx: OfflineAudioContext,
  buffer: AudioBuffer,
  offset: number,
  length: number
): AudioBuffer {
  const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    out.getChannelData(channel).set(buffer.getChannelData(channel).subarray(offset, offset + length))
  }
  return out
}
