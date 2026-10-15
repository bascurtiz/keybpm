/**
 * Rubber Band R3 as a non-realtime stretcher, driven synchronously from the
 * main thread.
 *
 * Why this exists next to ./offline-stretch (the SoundTouch core): Rubber Band
 * is the higher-quality engine — formant-aware, with an explicit high-quality
 * mode — and its R3 kernel is already shipped with this app as the live keylock
 * worklet's WASM. The render path previously had no way to use it.
 *
 * Why it is not a one-liner: `rubberband-web@0.2.1` exports only
 * `createRubberBandNode`, an `AudioWorkletNode` factory, and its bundle talks to
 * the engine exclusively through `port.postMessage`, which never reaches a
 * render thread. The engine itself is a plain emscripten module, so this module
 * evaluates the app's own processor asset in the main thread with the two
 * AudioWorklet globals stubbed, captures the processor class, and drives the
 * same API object the worklet uses:
 *
 *     api.setTempo(1 / tempo)      // RB's tempo is an output/input *length*
 *     api.setPitch(2^(semitones/12))
 *     api.push([left, right])      // 128-frame blocks
 *     api.pull([outLeft, outRight])   while api.samplesAvailable >= 128
 *
 * Two things about that API are worth knowing, both verified against the
 * shipped bundle rather than assumed:
 *
 *  - `setTempo(x)` makes the output `x` times *longer*, so playing faster by
 *    `tempo` requires `setTempo(1 / tempo)`. Measured steady-state output/input
 *    ratios: `setTempo(1.25)` -> 1.250, `setTempo(0.8)` -> 0.801,
 *    `setTempo(1)` -> 0.998, all with pitch unchanged.
 *  - The packaged `process()` calls `getApi(frameCount)`, which passes the
 *    *frame count* as the channel count, so the worklet builds a 128-channel
 *    kernel. This module therefore takes the API class from a throwaway instance
 *    and constructs it with two channels.
 *
 * The engine holds input back (measured: ~0.95 frames out per frame in over 900
 * blocks at tempo 1, i.e. roughly a 0.1 s pipeline), so a segment read window is
 * extended by {@link rubberBandHoldFrames} and the tail is flushed with silence
 * before the last drain.
 */

/** Frames per kernel block. The shipped wrapper fixes its buffers at 128. */
export const RB_BLOCK = 128

/**
 * The app's existing processor asset, served from `public/`. Loaded with a
 * script tag rather than `import()`: Vite refuses to bundle a JS file that lives
 * in `public/`, and a worker-style processor script registers itself on
 * evaluation anyway.
 */
const RB_ASSET_URL = '/rubberband-processor.js'

/** Measured pipeline latency of the R3 kernel, in seconds, plus a small margin. */
const RB_LATENCY_SECONDS = 0.15

/**
 * Input silence pushed before a segment, in seconds.
 *
 * The realtime kernel primes itself from the first frames it is given and
 * therefore swallows the start of whatever it is fed. Measured on a marker
 * signal at 48 kHz, the output content arrives 39.9 ms early at tempo 1.0,
 * 31.9 ms at 1.25, 52.1 ms at 0.8 and 25.3 ms at 1.5 — i.e. a constant ~40 ms of
 * *input* time, independent of tempo. Feeding that much silence first absorbs the
 * loss (its processed output is discarded), so the segment's own timeline starts
 * where it should. Measured residual alignment error after this lead: +9 to
 * +11 ms with 50 ms of lead, which is the overshoot, so the lead is the measured
 * loss itself.
 */
const RB_INPUT_LEAD_SECONDS = 0.04

/** Blocks of silence pushed at the end of a segment to flush the pipeline. */
const RB_FLUSH_BLOCKS = Math.ceil(RB_LATENCY_SECONDS / (RB_BLOCK / 48000)) + 4

/** Same shape as ./offline-stretch, so the renderer can swap backends. */
export interface RubberBandSink {
  write(interleaved: Float32Array, frames: number): void
}

export interface RubberBandSource {
  left: Float32Array
  right: Float32Array
  offset: number
  frames: number
}

export interface RubberBandRunOptions {
  /** Cooperatively yields every N blocks to keep the UI responsive. */
  yieldEveryBlocks?: number
  onProgress?: (framesDone: number, framesTotal: number) => void
}

interface RubberBandKernel {
  setPitch(pitch: number): void
  setTempo(tempo: number): void
  setFormantScale(scale: number): void
  push(channels: Float32Array[]): void
  pull(channels: Float32Array[]): void
  getSamplesAvailable(): number
  getVersion(): string
}

/** The wrapper object the worklet uses, with its buffers and channel handling. */
interface RubberBandApi {
  kernel: RubberBandKernel | undefined
  tempo: number
  pitch: number
  numSamples: number
  setTempo(tempo: number): void
  setPitch(pitch: number): void
  push(channels: Float32Array[]): void
  pull(channels: Float32Array[]): void
  readonly samplesAvailable: number
  getChannelCount(): number
  getVersion(): string
}

type RubberBandApiCtor = new (
  sampleRate: number,
  channels: number,
  options: { highQuality?: boolean; pitch?: number; tempo?: number; numSamples?: number }
) => RubberBandApi

let apiCtorPromise: Promise<RubberBandApiCtor | null> | null = null
let scriptInjected = false

function injectProcessorScript(): Promise<void> {
  if (scriptInjected) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = RB_ASSET_URL
    script.async = true
    script.onload = () => {
      scriptInjected = true
      resolve()
    }
    script.onerror = () => reject(new Error(`could not load ${RB_ASSET_URL}`))
    document.head.appendChild(script)
  })
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Fetch the API class out of the app's own processor bundle, once per session.
 *
 * Returns `null` rather than throwing when the asset is missing or the globals
 * cannot be stubbed, so a render can fall back to the SoundTouch core.
 */
async function loadApiCtor(): Promise<RubberBandApiCtor | null> {
  if (apiCtorPromise) return apiCtorPromise
  apiCtorPromise = (async () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null

    const globals = globalThis as unknown as Record<string, unknown>
    const saved = {
      AudioWorkletProcessor: globals.AudioWorkletProcessor,
      registerProcessor: globals.registerProcessor,
    }
    let captured: unknown = null

    try {
      // The asset is the same processor the live keylock worklet loads. It is a
      // self-running bundle that registers itself, so it needs the worklet
      // globals present to evaluate at all.
      globals.AudioWorkletProcessor = class {
        port = { postMessage() {}, onmessage: null }
      }
      globals.registerProcessor = (_name: string, ctor: unknown) => {
        captured = ctor
      }
      // `sampleRate` has to stay defined for the rest of the session: the bundle
      // reads it when it builds a kernel, and it builds that kernel from an
      // emscripten module promise, i.e. after this function has returned.
      installSampleRateStub(48000)

      await injectProcessorScript()

      if (typeof captured !== 'function') return null

      // The probe instance has to be built while the stubs are still in place:
      // `getApi` reads the global `sampleRate` when it constructs its own API.
      const Processor = captured as new (options: AudioWorkletNodeOptions) => {
        getApi(channels: number): { constructor: unknown }
      }
      const probe = new Processor({ numberOfInputs: 1, numberOfOutputs: 1, processorOptions: {} })
      const api = probe.getApi(RB_BLOCK)
      const Ctor = (api as { constructor: RubberBandApiCtor }).constructor
      if (typeof Ctor !== 'function') return null
      return Ctor
    } catch (err) {
      console.warn('Rubber Band engine could not be loaded:', err)
      return null
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globals[key]
        else globals[key] = value
      }
    }
  })()
  return apiCtorPromise
}

/**
 * Provide the AudioWorklet global the bundle reads when it constructs a kernel.
 * A Window has no native `sampleRate`, so this only creates one where none
exists, and points it at the rate actually being rendered.
 */
function installSampleRateStub(sampleRate: number): void {
  const globals = globalThis as unknown as Record<string, unknown>
  const existing = globals.sampleRate
  if (typeof existing === 'number') {
    globals.sampleRate = sampleRate
    return
  }
  try {
    Object.defineProperty(globals, 'sampleRate', {
      value: sampleRate,
      writable: true,
      configurable: true,
    })
  } catch {
    globals.sampleRate = sampleRate
  }
}

/** True when the Rubber Band engine can be used in this session. */
export async function isRubberBandAvailable(): Promise<boolean> {
  return (await loadApiCtor()) !== null
}

/** Version string of the loaded Rubber Band library, for provenance. */
export async function rubberBandVersion(): Promise<string | null> {
  const api = await createApi(48000)
  if (!api) return null
  try {
    const version = String(api.getVersion())
    // The wrapper reports 0 when the kernel was never built.
    return version === '0' ? null : version
  } catch {
    return null
  }
}

async function createApi(sampleRate: number): Promise<RubberBandApi | null> {
  const Ctor = await loadApiCtor()
  if (!Ctor) return null
  // Keep the stub in step with the rate being rendered: the kernel is built
  // asynchronously and reads this global.
  installSampleRateStub(sampleRate)
  const api = new Ctor(sampleRate, 2, { highQuality: true, pitch: 1, tempo: 1, numSamples: RB_BLOCK })
  // The kernel is built from an emscripten module promise, so it appears a few
  // event-loop turns after construction.
  for (let i = 0; i < 200 && !api.kernel; i++) await yieldToEventLoop()
  return api.kernel ? api : null
}

/**
 * Source frames this engine holds back, so callers can extend the read window
 * and still get a segment's full tail. Mirrors `stretchHoldFrames`.
 */
export function rubberBandHoldFrames(sampleRate: number, tempo: number, semitones = 0): number {
  const speed = tempo > 0 ? tempo : 1
  const flush = RB_FLUSH_BLOCKS * RB_BLOCK
  const resample = semitones !== 0 ? Math.ceil(sampleRate * Math.abs(semitones) * 0.01) : 0
  // The priming lead is consumed before the segment, and the flush tail is
  // consumed after it, so both widen the read window.
  return Math.ceil(flush * speed) + resample + RB_BLOCK + Math.ceil(RB_INPUT_LEAD_SECONDS * sampleRate)
}

function clampFrames(src: RubberBandSource): number {
  return Math.max(0, Math.min(src.frames, src.left.length - src.offset))
}

/**
 * Drives the kernel over a segment, writing interleaved stereo to `sink`.
 *
 * `tempo` follows the renderer's convention (output is `1 / tempo` as long as
 * the input, pitch untouched); `semitones` transposes without changing length.
 */
async function runRubberBand(
  api: RubberBandApi,
  sink: RubberBandSink,
  src: RubberBandSource,
  sampleRateHint: number,
  tempo: number,
  semitones: number,
  opts: RubberBandRunOptions
): Promise<number> {
  const inL = new Float32Array(RB_BLOCK)
  const inR = new Float32Array(RB_BLOCK)
  const outL = new Float32Array(RB_BLOCK)
  const outR = new Float32Array(RB_BLOCK)
  const interleaved = new Float32Array(RB_BLOCK * 2)

  api.setTempo(1 / tempo)
  if (semitones !== 0) api.setPitch(Math.pow(2, semitones / 12))

  const available = clampFrames(src)
  const yieldEvery = opts.yieldEveryBlocks ?? 512
  let written = 0
  let blocks = 0

  const drain = (): void => {
    let guard = 0
    while (api.samplesAvailable >= RB_BLOCK && guard++ < 64) {
      outL.fill(0)
      outR.fill(0)
      api.pull([outL, outR])
      for (let i = 0; i < RB_BLOCK; i++) {
        interleaved[i * 2] = outL[i]
        interleaved[i * 2 + 1] = outR[i]
      }
      sink.write(interleaved, RB_BLOCK)
      written += RB_BLOCK
    }
  }

  // Absorb the kernel's priming loss with silence, discarding its output, so the
  // first source frame lands on the segment's own timeline position.
  const leadBlocks = Math.ceil((RB_INPUT_LEAD_SECONDS * sampleRateHint) / RB_BLOCK)
  inL.fill(0)
  inR.fill(0)
  for (let i = 0; i < leadBlocks; i++) {
    api.push([inL, inR])
    let guard = 0
    while (api.samplesAvailable >= RB_BLOCK && guard++ < 64) {
      outL.fill(0)
      outR.fill(0)
      api.pull([outL, outR])
    }
    if (i % 32 === 31) await yieldToEventLoop()
  }

  for (let at = 0; at < available; at += RB_BLOCK) {
    const n = Math.min(RB_BLOCK, available - at)
    for (let i = 0; i < n; i++) {
      inL[i] = src.left[src.offset + at + i] ?? 0
      inR[i] = src.right[src.offset + at + i] ?? 0
    }
    for (let i = n; i < RB_BLOCK; i++) {
      inL[i] = 0
      inR[i] = 0
    }
    api.push([inL, inR])
    drain()
    if (++blocks % yieldEvery === 0) {
      opts.onProgress?.(Math.min(at + n, available), available)
      await yieldToEventLoop()
    }
  }

  // Flush: the kernel holds roughly `RB_LATENCY_SECONDS` of the tail, so push
  // silence until it has handed back everything it was given.
  const expected = Math.ceil(available / tempo)
  for (let i = 0; i < RB_FLUSH_BLOCKS && written < expected - RB_BLOCK; i++) {
    inL.fill(0)
    inR.fill(0)
    api.push([inL, inR])
    drain()
    await yieldToEventLoop()
  }
  opts.onProgress?.(available, available)
  return written
}

/**
 * Rubber Band time-stretch (keylock), optionally with a key shift.
 *
 * Returns frames written, or `null` when the engine is unavailable. Pitch and
 * tempo are applied in a single pass when both are needed: that is what the
 * library is designed for, and it avoids resynthesising the audio twice the way
 * a pitch stage followed by a stretch stage does.
 */
export async function rubberBandTimeStretchTo(
  sink: RubberBandSink,
  src: RubberBandSource,
  sampleRate: number,
  tempo: number,
  opts: RubberBandRunOptions & { semitones?: number } = {}
): Promise<number | null> {
  if (!(tempo > 0)) throw new Error(`invalid tempo ${tempo}`)
  const api = await createApi(sampleRate)
  if (!api) return null
  try {
    return await runRubberBand(api, sink, src, sampleRate, tempo, opts.semitones ?? 0, opts)
  } finally {
    api.kernel = undefined
  }
}

/** Rubber Band pitch shift with the length preserved. Returns frames written. */
export async function rubberBandPitchShiftTo(
  sink: RubberBandSink,
  src: RubberBandSource,
  sampleRate: number,
  semitones: number,
  opts: RubberBandRunOptions = {}
): Promise<number | null> {
  const api = await createApi(sampleRate)
  if (!api) return null
  try {
    return await runRubberBand(api, sink, src, sampleRate, 1, semitones, opts)
  } finally {
    api.kernel = undefined
  }
}
