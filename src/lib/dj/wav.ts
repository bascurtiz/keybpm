/**
 * WAV encoding for rendered mixes.
 *
 * A rendered mix is written to a file, not streamed, so a plain RIFF/WAVE file
 * in a Blob is the whole feature: no encoder dependency, no re-encoding loss,
 * and every DAW, phone and car stereo reads it. 24-bit PCM is the default
 * because a mix that has been through a limiter has real signal below -96 dB
 * that 16-bit truncates.
 */

export type WavBitDepth = 16 | 24 | 32

export interface WavOptions {
  /** `16` / `24` are integer PCM, `32` is IEEE float. Defaults to `24`. */
  bitDepth?: WavBitDepth
}

/** Bytes per sample for a bit depth. */
export function bytesPerSample(bitDepth: WavBitDepth): number {
  return bitDepth === 16 ? 2 : bitDepth === 24 ? 3 : 4
}

/**
 * Encodes planar channel data as a WAV file.
 *
 * Channels must all be `frames` long; shorter inputs are zero-padded rather than
 * rejected so a truncated render still produces a playable file.
 */
export function encodeWavPlanar(
  channels: Float32Array[],
  sampleRate: number,
  options: WavOptions = {}
): Blob {
  if (channels.length === 0) throw new Error('cannot encode WAV with no channels')
  if (!(sampleRate > 0)) throw new Error(`invalid sample rate ${sampleRate}`)

  const bitDepth = options.bitDepth ?? 24
  const channelCount = channels.length
  const frames = channels[0].length
  const sampleBytes = bytesPerSample(bitDepth)
  const blockAlign = channelCount * sampleBytes
  const dataBytes = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  const format = bitDepth === 32 ? 3 : 1 // 3 = IEEE float, 1 = integer PCM

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)

  let at = 44
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = channels[channel][frame] ?? 0
      if (bitDepth === 32) {
        view.setFloat32(at, sample, true)
      } else {
        // Clamp before quantising so an overdriven render clips instead of
        // wrapping to the opposite polarity.
        const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample
        if (bitDepth === 16) {
          view.setInt16(at, Math.round(clamped * 32767), true)
        } else {
          const value = Math.round(clamped * 8388607)
          view.setUint8(at, value & 0xff)
          view.setUint8(at + 1, (value >> 8) & 0xff)
          view.setUint8(at + 2, (value >> 16) & 0xff)
        }
      }
      at += sampleBytes
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/** Encodes an `AudioBuffer` (or anything buffer-shaped) as a WAV file. */
export function encodeWav(buffer: AudioBuffer, options: WavOptions = {}): Blob {
  const channels: Float32Array[] = []
  for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i))
  return encodeWavPlanar(channels, buffer.sampleRate, options)
}

/** Parses the header fields of a WAV file. Test-facing, and used for sanity checks. */
export function readWavHeader(bytes: Uint8Array): {
  format: number
  channels: number
  sampleRate: number
  bitDepth: number
  dataBytes: number
  frames: number
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset: number) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') throw new Error('not a WAV file')
  const channels = view.getUint16(22, true)
  const bitDepth = view.getUint16(34, true)
  const dataBytes = view.getUint32(40, true)
  const blockAlign = channels * bytesPerSample(bitDepth as WavBitDepth)
  return {
    format: view.getUint16(20, true),
    channels,
    sampleRate: view.getUint32(24, true),
    bitDepth,
    dataBytes,
    frames: blockAlign > 0 ? dataBytes / blockAlign : 0,
  }
}
