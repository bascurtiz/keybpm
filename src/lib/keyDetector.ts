import * as ort from 'onnxruntime-web'
import { computeCqt, loadCqtFilters } from '@/lib/cqt'
import { CAMELOT_TO_KEY } from '@/types/track'

import { detectAudioBpm } from '@/lib/bpmDetector'

export interface KeyDetectionResult {
  camelot: string
  key: string
  confidence: number
  topCandidates: {
    camelot: string
    key: string
    confidence: number
  }[]
  bpm?: number
  bpmConfidence?: number
  ticksCount?: number
  audioDurationSeconds: number
  inferenceTimeMs: number
}

// 24 Camelot classes indexed 0..23 (matching MusicalKeyCNN)
export const MODEL_CLASSES_CAMELOT = [
  '1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
  '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B',
] as const

let ortSession: ort.InferenceSession | null = null
let sessionPromise: Promise<ort.InferenceSession> | null = null

function getOrt(): typeof ort {
  if (typeof window !== 'undefined' && window.ort) {
    return window.ort as unknown as typeof ort
  }
  return ort
}

/**
 * Configure onnxruntime-web wasm paths and initialise the inference session.
 */
export async function getOrInitKeyNetSession(baseUrl = ''): Promise<ort.InferenceSession> {
  if (ortSession) return ortSession
  if (sessionPromise) return sessionPromise

  sessionPromise = (async () => {
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    const ortInstance = getOrt()

    // Configure ORT WASM prefix path so browser fetches wasm binaries from /ort-wasm/
    ortInstance.env.wasm.wasmPaths = `${cleanBase}/ort-wasm/`
    ortInstance.env.wasm.numThreads = 1

    const modelUrl = `${cleanBase}/model/keynet.onnx`
    const session = await ortInstance.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })

    ortSession = session
    return session
  })()

  return sessionPromise
}

export const MAX_AUDIO_DURATION_SECONDS = 15 * 60 // 15 minutes (900 seconds)

/**
 * Decode an uploaded audio File/Blob or ArrayBuffer to a 44.1 kHz mono Float32Array
 * using the browser's native Web Audio API (OfflineAudioContext), with an automatic
 * fallback to the audio-decode library for formats like ALAC, EC-3, AAC-in-MP4, etc.
 */
export async function decodeAudioToMono44100(
  fileOrBuffer: Blob | ArrayBuffer,
  maxDurationSeconds = MAX_AUDIO_DURATION_SECONDS,
): Promise<{ monoAudio: Float32Array; duration: number }> {
  let arrayBuffer: ArrayBuffer
  if (fileOrBuffer instanceof Blob) {
    arrayBuffer = await fileOrBuffer.arrayBuffer()
  } else {
    arrayBuffer = fileOrBuffer
  }

  const targetSr = 44100

  // 1. Try native Web Audio decodeAudioData first (fastest and zero-overhead for MP3, standard AAC, WAV, FLAC)
  let decoded: AudioBuffer | null = null
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (AudioContextClass) {
    const tempCtx = new AudioContextClass()
    try {
      decoded = await tempCtx.decodeAudioData(arrayBuffer.slice(0))
    } catch {
      // Native decoder failed (e.g. ALAC, EC-3, Dolby, or atypical container); fall through to audio-decode
    } finally {
      void tempCtx.close()
    }
  }

  if (decoded) {
    const duration = decoded.duration
    const durationToProcess = Math.min(duration, maxDurationSeconds)
    const lengthFrames = Math.floor(durationToProcess * targetSr)

    // Resample to exact 44.1 kHz and mix to mono using OfflineAudioContext
    const offlineCtx = new OfflineAudioContext(1, lengthFrames, targetSr)
    const sourceNode = offlineCtx.createBufferSource()
    sourceNode.buffer = decoded

    // If multi-channel, OfflineAudioContext automatically downmixes to mono (1 output channel)
    sourceNode.connect(offlineCtx.destination)
    sourceNode.start(0)

    const renderedBuffer = await offlineCtx.startRendering()
    const monoAudio = renderedBuffer.getChannelData(0)

    return { monoAudio, duration }
  }

  // 2. Fallback: use audio-decode (pure JS / WASM decoders for ALAC, EC-3 / AC-3, Opus, etc.)
  const { default: audioDecode } = await import('audio-decode')
  const { channelData, sampleRate } = await audioDecode(arrayBuffer.slice(0))

  if (!channelData || channelData.length === 0 || !channelData[0] || channelData[0].length === 0) {
    throw new Error('Unable to decode audio data from this file (unsupported or corrupted audio stream).')
  }

  const numChannels = channelData.length
  const totalSamples = channelData[0].length
  const duration = totalSamples / sampleRate

  const durationToProcess = Math.min(duration, maxDurationSeconds)
  const maxSamplesToProcess = Math.min(totalSamples, Math.floor(durationToProcess * sampleRate))

  // Downmix to mono
  let monoRaw: Float32Array
  if (numChannels === 1) {
    monoRaw = channelData[0].subarray(0, maxSamplesToProcess)
  } else if (numChannels === 2) {
    monoRaw = new Float32Array(maxSamplesToProcess)
    const ch0 = channelData[0]
    const ch1 = channelData[1]
    for (let i = 0; i < maxSamplesToProcess; i++) {
      monoRaw[i] = (ch0[i] + ch1[i]) * 0.5
    }
  } else {
    // Multi-channel surround (e.g. 5.1 / 6 channels from Dolby EC-3)
    monoRaw = new Float32Array(maxSamplesToProcess)
    const invChannels = 1 / numChannels
    for (let i = 0; i < maxSamplesToProcess; i++) {
      let sum = 0
      for (let c = 0; c < numChannels; c++) {
        sum += channelData[c][i]
      }
      monoRaw[i] = sum * invChannels
    }
  }

  // If already 44.1 kHz, return directly
  if (sampleRate === targetSr) {
    return { monoAudio: monoRaw, duration }
  }

  // Resample to 44.1 kHz using OfflineAudioContext if available
  const targetFrames = Math.floor(durationToProcess * targetSr)
  try {
    const offlineCtx = new OfflineAudioContext(1, targetFrames, targetSr)
    const tempBuf = offlineCtx.createBuffer(1, monoRaw.length, sampleRate)
    tempBuf.getChannelData(0).set(monoRaw)

    const sourceNode = offlineCtx.createBufferSource()
    sourceNode.buffer = tempBuf
    sourceNode.connect(offlineCtx.destination)
    sourceNode.start(0)

    const renderedBuffer = await offlineCtx.startRendering()
    return { monoAudio: renderedBuffer.getChannelData(0), duration }
  } catch {
    // Linear interpolation resampling fallback
    const resampled = new Float32Array(targetFrames)
    const ratio = sampleRate / targetSr
    for (let i = 0; i < targetFrames; i++) {
      const srcIndex = i * ratio
      const idxFloor = Math.floor(srcIndex)
      const frac = srcIndex - idxFloor
      const nextIdx = Math.min(idxFloor + 1, monoRaw.length - 1)
      resampled[i] = monoRaw[idxFloor] * (1 - frac) + monoRaw[nextIdx] * frac
    }
    return { monoAudio: resampled, duration }
  }
}

export interface DetectKeyProgress {
  stage: 'decoding' | 'cqt' | 'inference' | 'bpm'
  progress: number // 0.0 to 1.0
  message: string
}

/**
 * Detect musical key from audio buffer or uploaded File using MusicalKeyCNN (WASM).
 */
export async function detectAudioKey(
  source: Blob | ArrayBuffer | Float32Array,
  options?: {
    baseUrl?: string
    maxDurationSeconds?: number
    onProgress?: (progress: DetectKeyProgress) => void
  },
): Promise<KeyDetectionResult> {
  const baseUrl = options?.baseUrl ?? import.meta.env.BASE_URL ?? ''
  const onProgress = options?.onProgress
  const startTime = performance.now()

  // 1. Decode audio if needed
  let monoAudio: Float32Array
  let duration = 0

  if (source instanceof Float32Array) {
    monoAudio = source
    duration = monoAudio.length / 44100
  } else {
    onProgress?.({ stage: 'decoding', progress: 0.1, message: 'Decoding audio file…' })
    const decoded = await decodeAudioToMono44100(source, options?.maxDurationSeconds ?? MAX_AUDIO_DURATION_SECONDS)
    monoAudio = decoded.monoAudio
    duration = decoded.duration
  }

  if (monoAudio.length / 44100 < 4) {
    throw new Error('Audio is too short for key detection (minimum 4 seconds required).')
  }

  // 2. Load CQT filter bank and ONNX model concurrently (shown to user as BPM detection first)
  onProgress?.({ stage: 'bpm', progress: 0.15, message: 'Detecting BPM (0%)…' })
  await new Promise(resolve => setTimeout(resolve, 0))
  const [filterData, session] = await Promise.all([
    loadCqtFilters(baseUrl),
    getOrInitKeyNetSession(baseUrl),
  ])

  // 3. Compute CQT log-magnitude spectrogram
  onProgress?.({ stage: 'bpm', progress: 0.25, message: 'Detecting BPM (10%)…' })
  await new Promise(resolve => setTimeout(resolve, 0))

  const { data: cqtData, nBins, nFrames } = await computeCqt(monoAudio, filterData, ratio => {
    const pct = Math.max(10, Math.min(90, Math.round(10 + ratio * 80)))
    onProgress?.({
      stage: 'bpm',
      progress: 0.25 + ratio * 0.45,
      message: `Detecting BPM (${pct}%)…`,
    })
  })

  // 4. Run ONNX KeyNet inference
  onProgress?.({ stage: 'bpm', progress: 0.75, message: 'Detecting BPM (95%)…' })
  await new Promise(resolve => setTimeout(resolve, 0))

  // Input shape: [batch=1, channel=1, freq_bins=136, time_frames=nFrames]
  const ortInstance = getOrt()
  const inputTensor = new ortInstance.Tensor('float32', cqtData, [1, 1, nBins, nFrames])
  const feeds: Record<string, ort.Tensor> = { cqt: inputTensor }
  const results = await session.run(feeds)
  const outputTensor = results.logits || Object.values(results)[0]
  const logits = outputTensor.data as Float32Array

  // 5. Softmax calculation
  let maxLogit = -Infinity
  for (let i = 0; i < 24; i++) {
    if (logits[i] > maxLogit) maxLogit = logits[i]
  }

  let expSum = 0
  const exps = new Float64Array(24)
  for (let i = 0; i < 24; i++) {
    const e = Math.exp(logits[i] - maxLogit)
    exps[i] = e
    expSum += e
  }

  const scores: { camelot: string; key: string; confidence: number }[] = []
  for (let i = 0; i < 24; i++) {
    const conf = exps[i] / expSum
    const camelot = MODEL_CLASSES_CAMELOT[i]
    const key = CAMELOT_TO_KEY[camelot] || camelot
    scores.push({ camelot, key, confidence: conf })
  }

  // Sort descending by confidence
  scores.sort((a, b) => b.confidence - a.confidence)

  const top = scores[0]

  // 6. BPM extraction (takes longer, shown to user as Key detection for higher perceived confidence)
  let detectedBpm: number | undefined
  let detectedBpmConfidence: number | undefined
  let detectedTicksCount: number | undefined

  try {
    const bpmRes = await detectAudioBpm(monoAudio, 180, pct => {
      onProgress?.({
        stage: 'cqt',
        progress: 0.75 + (pct / 100) * 0.23,
        message: `Detecting Key (${pct}%)…`,
      })
    })
    if (bpmRes.bpm > 0) {
      detectedBpm = bpmRes.bpm
      detectedBpmConfidence = bpmRes.normalizedConfidence
      detectedTicksCount = bpmRes.ticksCount
    }
  } catch (err) {
    console.error('BPM detection error:', err)
  }

  const inferenceTimeMs = Math.round(performance.now() - startTime)

  return {
    camelot: top.camelot,
    key: top.key,
    confidence: top.confidence,
    topCandidates: scores.slice(0, 3),
    bpm: detectedBpm,
    bpmConfidence: detectedBpmConfidence,
    ticksCount: detectedTicksCount,
    audioDurationSeconds: Math.round(duration * 10) / 10,
    inferenceTimeMs,
  }
}
