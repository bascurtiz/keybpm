/**
 * Auto-gain: measure a track's perceived loudness and return the linear
 * gain that brings it to a common reference level.
 *
 * Loudness is taken as the 90th percentile of 400ms block RMS — loud
 * enough to represent the meat of the track, robust against silence,
 * intros, and single peaks.
 */

const BLOCK_SECONDS = 0.4
const TARGET_RMS = 0.22 // ≈ -13 dBFS, typical mastered club material
const MIN_GAIN = 0.4
const MAX_GAIN = 3

export function computeAutoGain(buffer: AudioBuffer): number {
  const sr = buffer.sampleRate
  const block = Math.floor(sr * BLOCK_SECONDS)
  const blocks = Math.floor(buffer.length / block)
  if (blocks < 4) return 1

  const rms: number[] = []
  const data = buffer.getChannelData(0)
  const data2 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data
  for (let b = 0; b < blocks; b++) {
    let sum = 0
    const base = b * block
    // Stride 4 keeps this fast; loudness estimates don't need every sample.
    for (let i = 0; i < block; i += 4) {
      const v = (data[base + i] + data2[base + i]) * 0.5
      sum += v * v
    }
    rms.push(Math.sqrt(sum / (block / 4)))
  }

  rms.sort((a, b) => a - b)
  const loudness = rms[Math.floor(rms.length * 0.9)]
  if (loudness < 1e-4) return 1

  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_RMS / loudness))
}
