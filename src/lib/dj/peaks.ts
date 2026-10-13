/**
 * Downsample an AudioBuffer into normalized waveform peaks (0..1),
 * one value per visual bucket. Used by the overview and zoomed waveform canvas.
 */
export function computePeaks(buffer: AudioBuffer, buckets = 2400): Float32Array {
  const peaks = new Float32Array(buckets)
  const channels = buffer.numberOfChannels
  const samplesPerBucket = Math.max(1, Math.floor(buffer.length / buckets))

  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < buckets; i++) {
      const start = i * samplesPerBucket
      const end = Math.min(start + samplesPerBucket, data.length)
      let max = 0
      // Stride through large buckets so huge files stay fast.
      const step = Math.max(1, Math.floor((end - start) / 64))
      for (let j = start; j < end; j += step) {
        const v = Math.abs(data[j])
        if (v > max) max = v
      }
      if (max > peaks[i]) peaks[i] = max
    }
  }

  // Normalize so quiet tracks still fill the lane.
  let overall = 0
  for (let i = 0; i < buckets; i++) if (peaks[i] > overall) overall = peaks[i]
  if (overall > 0) {
    for (let i = 0; i < buckets; i++) peaks[i] = peaks[i] / overall
  }
  return peaks
}
