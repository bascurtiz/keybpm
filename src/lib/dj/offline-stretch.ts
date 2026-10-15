/**
 * Non-realtime time-stretching for the offline mix renderer.
 *
 * The mixer's live keylock runs inside an AudioWorklet, and there the WSOLA
 * window cannot be tuned: `SoundTouchNode.setStretchParameters` posts a message
 * to the render thread, and inside an `OfflineAudioContext` that message never
 * arrives. Measured in Chromium: rendering with `sequenceMs: 220, overlapMs: 40,
 * quickSeek: false` and with `sequenceMs: 60, overlapMs: 4, quickSeek: true`
 * produces bit-identical output, as does switching Lanczos for linear. The same
 * is true of `processOffline` from `@soundtouchjs/audio-worklet`.
 *
 * So instead of driving the worklet, the renderer runs `@soundtouchjs/core`
 * directly on the main thread. That makes every quality knob deterministic and
 * effective: window lengths, the exhaustive (non-quick) seek search that the
 * library reserves for offline work, and the Lanczos resampler. The core is the
 * package's documented offline entry point.
 *
 * Everything here is plain arithmetic over Float32 arrays, so it is exercisable
 * from Node (see scripts/test-mix-render.mjs) with no Web Audio present.
 */
import { SoundTouch, Stretch, type SampleBuffer } from '@soundtouchjs/core'

/**
 * Windows used for rendered mixes. Longer than the realtime node's automatic
 * windows (50-125 ms sequence) because latency is irrelevant offline, and an
 * exhaustive seek search rather than the fast multi-pass one, which the library
 * documents as "better quality at lower tempos".
 */
export const RENDER_STRETCH: Required<StretchParametersConcept> = {
  sequenceMs: 110,
  seekWindowMs: 28,
  overlapMs: 14,
  quickSeek: false,
}

/** `StretchParameters` with every field required, for defaults we always pass. */
interface StretchParametersConcept {
  sequenceMs?: number
  seekWindowMs?: number
  overlapMs?: number
  quickSeek?: boolean
}

/** Planar stereo source: the two channel arrays of an AudioBuffer, plus a read window. */
export interface PlanarSource {
  left: Float32Array
  right: Float32Array
  /** Read start in frames. */
  offset: number
  /** Number of frames to read from `offset`. Clamped to the available length. */
  frames: number
}

/** Receives interleaved stereo output in arrival order. */
export interface InterleavedSink {
  /** @param interleaved L R L R ... @param frames Frame count (2 floats per frame). */
  write(interleaved: Float32Array, frames: number): void
}

export interface StretchRunOptions {
  /** Cooperative pause interval in output frames; keeps the UI responsive. */
  yieldEveryFrames?: number
  onProgress?: (framesDone: number, framesTotal: number) => void
}

/** Structural shape shared by the core's `Stretch` and `SoundTouch` stages. */
interface ProcessPipe {
  inputBuffer: SampleBuffer | null
  outputBuffer: SampleBuffer | null
  process(): void
  clear(): void
}

/** Frames fed to a pipe per iteration. Comfortably above any stage's `sampleReq`. */
const FEED_FRAMES = 8192

/**
 * Source frames that a stretch run leaves trapped inside the pipeline and
 * therefore never emits. Callers extend the read window by this much so the
 * audible part of a segment is complete; the extra output is simply never
 * played.
 */
export function stretchHoldFrames(
  sampleRate: number,
  tempo: number,
  params: Required<StretchParametersConcept> = RENDER_STRETCH
): number {
  const pipe = makeStretch(sampleRate, tempo, params)
  const held = pipe.sampleReq + pipe.overlapLength
  return held + Math.ceil(sampleRate * 0.02)
}

/**
 * Tempo multiplier that the WSOLA stage applies: output is `1/tempo` as long as
 * its input, with pitch untouched. `tempo > 1` plays faster.
 */
function makeStretch(
  sampleRate: number,
  tempo: number,
  params: Required<StretchParametersConcept>
): Stretch {
  const pipe = new Stretch({ sampleRate, createBuffers: true })
  pipe.setStretchParameters({
    sequenceMs: params.sequenceMs,
    seekWindowMs: params.seekWindowMs,
    overlapMs: params.overlapMs,
    quickSeek: params.quickSeek,
  })
  pipe.tempo = tempo
  return pipe
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Drives one processing pipe over a planar source, delivering interleaved output
 * to `sink`. Returns the number of frames written.
 */
async function runPipe(
  pipe: ProcessPipe,
  src: PlanarSource,
  sink: InterleavedSink,
  opts: StretchRunOptions = {}
): Promise<number> {
  const inputBuffer = pipe.inputBuffer
  const outputBuffer = pipe.outputBuffer
  if (!inputBuffer || !outputBuffer) throw new Error('processing pipe has no buffers')

  const available = Math.max(0, Math.min(src.frames, src.left.length - src.offset))
  const interleaved = new Float32Array(FEED_FRAMES * 2)
  let scratch = new Float32Array(FEED_FRAMES * 4)
  const yieldEvery = opts.yieldEveryFrames ?? 1_000_000
  let sinceYield = 0
  let written = 0
  let read = 0

  while (read < available) {
    const n = Math.min(FEED_FRAMES, available - read)
    for (let i = 0; i < n; i++) {
      interleaved[i * 2] = src.left[src.offset + read + i] ?? 0
      interleaved[i * 2 + 1] = src.right[src.offset + read + i] ?? 0
    }
    inputBuffer.putSamples(interleaved, 0, n)
    read += n
    pipe.process()

    const pending = outputBuffer.frameCount
    if (pending > 0) {
      if (scratch.length < pending * 2) scratch = new Float32Array(pending * 2)
      outputBuffer.extract(scratch, 0, pending)
      outputBuffer.receive(pending)
      sink.write(scratch, pending)
      written += pending
      sinceYield += pending
      opts.onProgress?.(read, available)
    }

    if (sinceYield >= yieldEvery) {
      sinceYield = 0
      await yieldToEventLoop()
    }
  }

  // Anything still buffered is the tail the caller already accounted for.
  return written
}

/**
 * Time-stretches `src` by `tempo` with pitch preserved (keylock), writing
 * interleaved stereo frames to `sink`.
 *
 * The output's first frame corresponds to the source's first frame: the WSOLA
 * stage consumes its priming overlap and emits from there, so a rendered
 * segment starts on its timeline position rather than after a pipeline delay.
 * Individual frames inside the output wander by up to half a seek window, which
 * is inherent to WSOLA and identical to the live engine's behaviour.
 */
export async function timeStretchTo(
  sink: InterleavedSink,
  src: PlanarSource,
  sampleRate: number,
  tempo: number,
  params: Required<StretchParametersConcept> = RENDER_STRETCH,
  opts: StretchRunOptions = {}
): Promise<number> {
  if (!(tempo > 0)) throw new Error(`invalid tempo ${tempo}`)
  return runPipe(makeStretch(sampleRate, tempo, params), src, sink, opts)
}

/** Source frames a pitch-shift run holds back. Same role as `stretchHoldFrames`. */
export function pitchShiftHoldFrames(sampleRate: number, semitones: number): number {
  // The core pairs a resample with a compensating stretch; both hold frames.
  return Math.ceil(sampleRate * (0.25 + Math.abs(semitones) * 0.02))
}

/**
 * Transposes `src` by `semitones` without changing its tempo.
 *
 * The core's `SoundTouch` derives its pipeline from `virtualPitch` (`_rate =
 * virtualPitch`, `_tempo = 1 / virtualPitch`), so this is a resample followed by
 * a compensating stretch: pitch moves, length does not.
 */
export async function pitchShiftTo(
  sink: InterleavedSink,
  src: PlanarSource,
  sampleRate: number,
  semitones: number,
  opts: StretchRunOptions = {}
): Promise<number> {
  const pipe = new SoundTouch({
    sampleRate,
    interpolationStrategy: 'lanczos',
    sampleBufferType: 'circular',
  })
  pipe.setStretchParameters({ ...RENDER_STRETCH })
  pipe.virtualPitch = Math.pow(2, semitones / 12)
  pipe.calculateEffectiveRateAndTempo()
  return runPipe(pipe, src, sink, opts)
}

/** Collects interleaved output into preallocated planar buffers. */
export function planarSink(
  left: Float32Array,
  right: Float32Array,
  capacityFrames: number
): InterleavedSink {
  let at = 0
  return {
    write(interleaved, frames) {
      const n = Math.min(frames, capacityFrames - at)
      for (let i = 0; i < n; i++) {
        left[at + i] = interleaved[i * 2]
        right[at + i] = interleaved[i * 2 + 1]
      }
      at += frames
    },
  }
}
