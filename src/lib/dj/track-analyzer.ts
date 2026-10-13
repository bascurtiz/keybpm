import { detectAudioKey } from '@/lib/keyDetector'
import { extractAudioMetadata } from '@/lib/audioMetadata'
import { analyzeBeatGrid } from './beatgrid'
import { computeAutoGain } from './autogain'
import { computePeaks } from './peaks'
import { positiveMod } from './dsp'
import type { Track } from './types'

export interface AnalyzeProgress {
  stage: 'decoding' | 'analyzing' | 'peaks' | 'ready'
  progress: number
  message: string
}

/**
 * Decode an uploaded audio File/Blob to a full stereo/mono AudioBuffer
 * using native Web Audio decodeAudioData with fallback to audio-decode.
 */
export async function decodeAudioBuffer(fileOrBlob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await fileOrBlob.arrayBuffer()
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext

  if (AudioContextClass) {
    const tempCtx = new AudioContextClass()
    try {
      return await tempCtx.decodeAudioData(arrayBuffer.slice(0))
    } catch {
      // Fall through to audio-decode
    } finally {
      void tempCtx.close()
    }
  }

  const { default: audioDecode } = await import('audio-decode')
  const { channelData, sampleRate } = await audioDecode(arrayBuffer.slice(0))

  if (!channelData || channelData.length === 0 || !channelData[0] || channelData[0].length === 0) {
    throw new Error('Unable to decode audio from this file.')
  }

  const numChannels = Math.min(channelData.length, 2)
  const length = channelData[0].length
  const audioCtx = new (AudioContextClass || AudioContext)()
  const buffer = audioCtx.createBuffer(numChannels, length, sampleRate)
  for (let c = 0; c < numChannels; c++) {
    buffer.getChannelData(c).set(channelData[c])
  }
  void audioCtx.close()
  return buffer
}

/**
 * Full track analysis pipeline:
 *  1. Metadata extraction (ID3 tags, title, artist, cover art)
 *  2. Audio PCM decoding
 *  3. Key detection via fine-tuned MusicalKeyCNN
 *  4. Beat-grid analysis & BPM detection
 *  5. Perceived loudness (AutoGain) & Waveform peaks calculation
 */
export async function analyzeTrackFile(
  file: File,
  onProgress?: (p: AnalyzeProgress) => void
): Promise<Track> {
  onProgress?.({
    stage: 'decoding',
    progress: 0.1,
    message: 'Extracting metadata & decoding audio…',
  })

  const [meta, buffer] = await Promise.all([
    extractAudioMetadata(file),
    decodeAudioBuffer(file),
  ])

  onProgress?.({
    stage: 'analyzing',
    progress: 0.45,
    message: 'Analyzing musical key & BPM…',
  })

  // Run key detection & beat grid in parallel
  const [keyResult, gridResult] = await Promise.all([
    detectAudioKey(file).catch(err => {
      console.warn('Key detection error in track analyzer:', err)
      return null
    }),
    analyzeBeatGrid(buffer).catch(err => {
      console.warn('Beatgrid error in track analyzer:', err)
      return null
    }),
  ])

  onProgress?.({
    stage: 'peaks',
    progress: 0.85,
    message: 'Rendering waveform peaks…',
  })

  const peaks = computePeaks(buffer)
  const gain = computeAutoGain(buffer)

  let bpm = gridResult?.bpm ?? keyResult?.bpm ?? null

  // Reconcile Beatgrid BPM with Essentia RhythmExtractor BPM
  if (gridResult && keyResult?.bpm && keyResult.bpm > 0) {
    const r = keyResult.bpm / gridResult.bpm
    // If beatgrid locked onto a 2/3 hemiola / dotted quarter (e.g. 84.9 vs 127.4)
    if (Math.abs(r - 1.5) < 0.08) {
      gridResult.bpm = Math.round(gridResult.bpm * 1.5 * 10) / 10
      bpm = gridResult.bpm
      const beatLen = 60 / gridResult.bpm
      gridResult.firstBeat = positiveMod(gridResult.firstBeat, beatLen)
      gridResult.firstBar = positiveMod(gridResult.firstBar, beatLen * gridResult.beatsPerBar)
    }
    // If beatgrid locked onto half-time (e.g. 64 vs 128)
    else if (Math.abs(r - 2.0) < 0.08 && keyResult.bpm >= 100) {
      gridResult.bpm = Math.round(gridResult.bpm * 2.0 * 10) / 10
      bpm = gridResult.bpm
      const beatLen = 60 / gridResult.bpm
      gridResult.firstBeat = positiveMod(gridResult.firstBeat, beatLen)
      gridResult.firstBar = positiveMod(gridResult.firstBar, beatLen * gridResult.beatsPerBar)
    }
    // If Essentia has high confidence and beatgrid significantly drifted outside dance tempo
    else if (
      keyResult.bpmConfidence &&
      keyResult.bpmConfidence > 0.75 &&
      Math.abs(keyResult.bpm - gridResult.bpm) > 6 &&
      keyResult.bpm >= 100 &&
      keyResult.bpm <= 165
    ) {
      gridResult.bpm = keyResult.bpm
      bpm = keyResult.bpm
      const beatLen = 60 / gridResult.bpm
      gridResult.firstBeat = positiveMod(gridResult.firstBeat, beatLen)
      gridResult.firstBar = positiveMod(gridResult.firstBar, beatLen * gridResult.beatsPerBar)
    }
  }

  const key = keyResult
    ? {
        name: keyResult.key,
        camelot: keyResult.camelot,
        confidence: keyResult.confidence,
      }
    : null

  const title = meta.title || file.name.replace(/\.[a-zA-Z0-9]+$/, '')
  const artist = meta.artist || 'Unknown Artist'

  onProgress?.({
    stage: 'ready',
    progress: 1.0,
    message: 'Ready to mix!',
  })

  return {
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    artist,
    label: meta.album,
    duration: buffer.duration,
    bpm,
    grid: gridResult,
    key,
    gain,
    buffer,
    coverUrl: meta.coverUrl,
    peaks,
  }
}
