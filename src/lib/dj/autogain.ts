/**
 * Auto-gain: measure a track's perceived loudness and return the linear
 * gain that brings it to a common reference level.
 *
 * Loudness is taken as the 90th percentile of 400ms block RMS — loud
 * enough to represent the meat of the track, robust against silence,
 * intros, and single peaks.
 */

const BLOCK_SECONDS = 0.4

/** The level every track is normalised to, as linear RMS (≈ -13 dBFS). */
export const TARGET_RMS = 0.22

/**
 * Gain limits.
 *
 * The floor is deliberately low. Attenuation costs nothing, and a tight floor
 * defeats the whole point: at 0.4 any track whose 90th-percentile RMS exceeded
 * 0.55 could not be pulled down to the target at all, so it stayed several dB
 * louder than every other track at the same fader position. A brickwalled
 * master is exactly that case.
 *
 * The ceiling is much tighter, because boosting a quiet recording boosts its
 * noise floor with it.
 */
const MIN_GAIN = 0.1
const MAX_GAIN = 6

/**
 * Perceived loudness of a buffer: the 90th percentile of its 400 ms block RMS.
 *
 * Exposed separately from {@link computeAutoGain} because other sources need to
 * be normalised against the same reference — the SCR cutter is a fixed sample
 * played over a track whose level has already been moved by its own auto-gain,
 * so it has to know both its own loudness and the track's.
 *
 * Returns `null` when the buffer is too short to measure, or is silent.
 */
export function measureLoudness(buffer: AudioBuffer): number | null {
  const sr = buffer.sampleRate
  const block = Math.floor(sr * BLOCK_SECONDS)
  const blocks = Math.floor(buffer.length / block)
  if (blocks < 4) return null

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
  return loudness < 1e-4 ? null : loudness
}

export function computeAutoGain(buffer: AudioBuffer): number {
  const loudness = measureLoudness(buffer)
  if (loudness === null) return 1
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_RMS / loudness))
}

/**
 * Whole-buffer RMS, as linear amplitude.
 *
 * The block statistic above needs a few seconds of material to say anything —
 * a percentile over two blocks is just the louder block. Sources that short
 * (the SCR cutter loop is about a second) have no quiet sections to be robust
 * against, so their plain RMS is the same number the block measure would have
 * reported anyway. Returns 0 for an empty or silent buffer.
 */
export function measureLevel(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0)
  const data2 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data
  let sum = 0
  let n = 0
  for (let i = 0; i < buffer.length; i += 4) {
    const v = (data[i] + data2[i]) * 0.5
    sum += v * v
    n++
  }
  return n > 0 ? Math.sqrt(sum / n) : 0
}
