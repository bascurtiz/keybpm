/**
 * PCM access shared by the analyzer, the browser and the headless benchmark.
 *
 * The analyzer never needed an `AudioBuffer` — it reads channel data, a length,
 * a sample rate and a duration. Depending on the concrete Web Audio type anyway
 * meant the only way to measure the analyzer was to run it in a browser, which is
 * why its accuracy claims were synthetic-only. `PcmSource` is the structural
 * minimum those code paths use, so a decoded file in Node and an `AudioBuffer` in
 * the browser are interchangeable.
 */

/** The subset of `AudioBuffer` the analyzer reads. */
export interface PcmSource {
  sampleRate: number
  /** Frames per channel. */
  length: number
  numberOfChannels: number
  /** Seconds. */
  duration: number
  getChannelData(channel: number): Float32Array
  /** Present on `AudioBuffer`; absent sources are read through `getChannelData`. */
  copyFromChannel?(destination: Float32Array, channelNumber: number, bufferOffset?: number): void
}

/**
 * Builds a source from planar channel data. Every channel is assumed to be the
 * same length, which is what a decoded audio file gives you.
 */
export function pcmFromChannels(channels: Float32Array[], sampleRate: number): PcmSource {
  if (channels.length === 0) throw new Error('PcmSource needs at least one channel')
  if (!(sampleRate > 0)) throw new Error(`invalid sample rate ${sampleRate}`)
  const length = channels[0].length
  for (const channel of channels) {
    if (channel.length !== length) throw new Error('PcmSource channels differ in length')
  }
  return {
    sampleRate,
    length,
    numberOfChannels: channels.length,
    duration: length / sampleRate,
    getChannelData: channel => channels[Math.max(0, Math.min(channels.length - 1, channel))],
  }
}

/**
 * Copies `frames` samples of `channel` starting at `start` into `destination`.
 *
 * Uses `copyFromChannel` when the source has one (the browser path, where the
 * copy avoids a full-channel materialisation) and slices otherwise. Reads past
 * the end are zero-filled rather than producing NaN, so a source that is one
 * frame short cannot silently corrupt a whole analysis window.
 */
export function readChannelInto(
  source: PcmSource,
  destination: Float32Array,
  channel: number,
  start = 0,
  frames = destination.length
): void {
  const count = Math.min(frames, destination.length)
  const offset = Math.max(0, Math.floor(start))
  if (source.copyFromChannel && offset + count <= source.length) {
    // AudioBuffer.copyFromChannel zero-fills the tail itself when the request
    // runs past the end, but only the in-range case is safe to delegate.
    const view = count === destination.length ? destination : destination.subarray(0, count)
    source.copyFromChannel(view, channel, offset)
    if (count < destination.length) destination.fill(0, count)
    return
  }
  const data = source.getChannelData(channel)
  for (let i = 0; i < count; i++) {
    const at = offset + i
    destination[i] = at < data.length ? data[at] : 0
  }
  if (count < destination.length) destination.fill(0, count)
}

/**
 * Mono view of a source at `sampleRate / decimation`, starting at `startSample`.
 *
 * Shared by the analyzer's three downmix sites, which each hand-rolled the same
 * decimate-and-average loop. Averaging adjacent samples before dropping the odd
 * one is a crude anti-alias filter, but it is the one this analyzer has always
 * used and it is what the measured numbers in the README describe.
 */
export function monoFromSource(
  source: PcmSource,
  startSample: number,
  frames: number,
  decimation: number
): Float32Array {
  const decim = Math.max(1, Math.floor(decimation))
  const outFrames = Math.max(0, Math.floor(frames / decim))
  const out = new Float32Array(outFrames)
  const scratchLen = outFrames * decim
  const scratch = new Float32Array(scratchLen)
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    readChannelInto(source, scratch, channel, startSample, scratchLen)
    if (outFrames === 0) break
    if (decim === 1) {
      for (let i = 0; i < outFrames; i++) out[i] += scratch[i] / source.numberOfChannels
    } else {
      for (let i = 0; i < outFrames; i++) {
        let sum = 0
        for (let k = 0; k < decim; k++) sum += scratch[i * decim + k]
        out[i] += sum / (decim * source.numberOfChannels)
      }
    }
  }
  return out
}

/** Analysis decimation for a sample rate: 2 above 32 kHz, 1 below. */
export function analysisDecimation(sampleRate: number): number {
  return sampleRate >= 32000 ? 2 : 1
}
