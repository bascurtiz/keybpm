/**
 * BPM Detector powered by Essentia RhythmExtractor2013 (WebAssembly).
 * Runs 100% locally on-device in the browser using the pre-decoded 44.1 kHz mono audio buffer.
 */

export interface BpmDetectionResult {
  bpm: number
  confidence: number // Raw Essentia score (0.0 to 5.32)
  normalizedConfidence: number // Calibrated 0.0 to 1.0 percentage
  ticksCount?: number
  inferenceTimeMs: number
}

/**
 * Normalizes Essentia RhythmExtractor2013 mutual agreement confidence score
 * (ranges from 0 to 5.32, where [0, 1) is low, [1.5, 3.5] represents ~80% accuracy, >3.5 is >90%)
 * into an honest percentage (0.0 to 1.0) calibrated against the Zapata et al. benchmark findings.
 */
export function normalizeBpmConfidence(rawScore: number): number {
  if (!rawScore || rawScore <= 0) return 0
  if (rawScore < 1.0) {
    // 0 to 1.0: 0% to 50%
    return Math.min(0.5, Math.max(0, (rawScore / 1.0) * 0.5))
  }
  if (rawScore <= 1.5) {
    // 1.0 to 1.5: 50% to 65%
    return 0.5 + ((rawScore - 1.0) / 0.5) * 0.15
  }
  if (rawScore <= 3.5) {
    // 1.5 to 3.5: 65% to 90% (e.g. score 2.7 -> 80.0%)
    return 0.65 + ((rawScore - 1.5) / 2.0) * 0.25
  }
  // 3.5 to 5.32: 90% to 99%
  const ratio = Math.min(1, (rawScore - 3.5) / 1.82)
  return 0.9 + ratio * 0.09
}

let essentiaPromise: Promise<{
  instance: any
}> | null = null

/**
 * Lazy load Essentia WASM on-demand when the user detects key/BPM.
 */
export async function getOrInitEssentia(): Promise<any> {
  if (essentiaPromise) return (await essentiaPromise).instance

  essentiaPromise = (async () => {
    // Dynamically import Essentia UMD bundle (WASM included)
    // @ts-expect-error essentia.js lacks TS declarations for UMD paths
    const EssentiaWASMModule = await import('essentia.js/dist/essentia-wasm.umd.js')
    // @ts-expect-error essentia.js lacks TS declarations for UMD paths
    const EssentiaCoreModule = await import('essentia.js/dist/essentia.js-core.umd.js')

    const wasmBackend =
      EssentiaWASMModule.default?.EssentiaWASM ||
      EssentiaWASMModule.EssentiaWASM ||
      (typeof window !== 'undefined' && (window as any).EssentiaWASM) ||
      EssentiaWASMModule.default ||
      EssentiaWASMModule

    const EssentiaCtor =
      EssentiaCoreModule.default?.Essentia ||
      (typeof EssentiaCoreModule.default === 'function' ? EssentiaCoreModule.default : null) ||
      EssentiaCoreModule.Essentia ||
      (typeof window !== 'undefined' && (window as any).Essentia) ||
      EssentiaCoreModule

    if (typeof EssentiaCtor !== 'function') {
      throw new Error(`Essentia constructor could not be resolved from UMD export: ${typeof EssentiaCtor}`)
    }

    const instance = new EssentiaCtor(wasmBackend)
    return { instance }
  })()

  return (await essentiaPromise).instance
}

/**
 * Detect BPM from a mono Float32Array at 44100 Hz using Essentia RhythmExtractor2013.
 *
 * @param monoAudio 44.1 kHz mono audio buffer
 * @param maxSeconds Maximum seconds of audio to analyze (defaults to 180s for speed & accuracy)
 */
export async function detectAudioBpm(
  monoAudio: Float32Array,
  maxSeconds = 180,
  onProgress?: (percentage: number) => void,
): Promise<BpmDetectionResult> {
  const startTime = performance.now()
  onProgress?.(15)
  await new Promise(resolve => setTimeout(resolve, 0))

  const essentia = await getOrInitEssentia()
  onProgress?.(45)
  await new Promise(resolve => setTimeout(resolve, 0))

  // Limit audio slice to maxSeconds (e.g. 180 seconds = 3 minutes is plenty for stable tempo estimation)
  const targetSamples = Math.min(monoAudio.length, Math.floor(maxSeconds * 44100))
  const audioSlice = targetSamples === monoAudio.length ? monoAudio : monoAudio.subarray(0, targetSamples)

  onProgress?.(70)
  await new Promise(resolve => setTimeout(resolve, 0))

  // Convert Float32Array to Essentia C++ std::vector<float>
  const vec = essentia.arrayToVector(audioSlice)

  let rawBpm = 0
  let confidence = 0
  let ticksCount = 0

  try {
    // Method 'multifeature' is the gold standard for DJ rhythm tracking
    // Parameters: signal, maxTempo (208), method ('multifeature'), minTempo (40)
    const result = essentia.RhythmExtractor2013(vec, 208, 'multifeature', 40)
    onProgress?.(95)
    await new Promise(resolve => setTimeout(resolve, 0))

    rawBpm = Number(result.bpm) || 0
    confidence = Number(result.confidence) || 0

    if (result.ticks) {
      ticksCount = typeof result.ticks.size === 'function' ? result.ticks.size() : result.ticks.length
      result.ticks.delete?.()
    }
    result.estimates?.delete?.()
    result.bpmIntervals?.delete?.()
  } finally {
    // Always free the C++ vector from WebAssembly heap
    vec.delete?.()
  }

  const inferenceTimeMs = Math.round(performance.now() - startTime)

  // Round BPM to 1 decimal place (e.g. 128.0, 127.5) while keeping raw precision available
  const roundedBpm = Math.round(rawBpm * 10) / 10

  return {
    bpm: roundedBpm,
    confidence: Math.round(confidence * 10) / 10,
    normalizedConfidence: normalizeBpmConfidence(confidence),
    ticksCount,
    inferenceTimeMs,
  }
}
