import { makeFft, positiveMod } from './dsp'
import type { BeatGrid } from './types'

/**
 * Mixxx-Inspired Beat-Grid and BPM Analyzer.
 *
 * Architecture based on Mixxx's AnalyzerQueenMaryBeats (qm-dsp / Davies & Plumbley)
 * and AnalyzerSoundTouchBeats (SoundTouch BPMDetect / PeakFinder):
 *
 *  1. Multi-Band Transient Spectral Flux (Onset Detection Function - ODF):
 *     Extracts 3 frequency sub-bands from audio PCM:
 *       - Low (Kick / Bass): 35 - 180 Hz (primary rhythmic pulse for DJ dance music)
 *       - Mid (Snare / Claps / Synth attacks): 180 - 1500 Hz
 *       - High (Hi-hats / Percussive clicks): 1500 - 8000 Hz
 *     Calculates half-wave rectified logarithmic spectral flux in each band.
 *
 *  2. Adaptive Background Suppression (Local moving average filter):
 *     Subtracts steady-state basslines and sustained pad drones so that only
 *     clean, explosive transient drum attacks produce positive spikes.
 *
 *  3. Autocorrelation & Comb Filter Bank with Mixxx DJ Dance Prior:
 *     Computes autocorrelation across the lag range corresponding to 65 - 195 BPM.
 *     Weights candidates using Mixxx's log-normal tempo prior centered at 125 BPM
 *     and evaluates harmonic multiples (2x, 3x, 0.5x) to eliminate half-tempo (64 BPM)
 *     or triplet hemiola (85.3 BPM) octave ambiguities.
 *
 *  4. Parabolic Peak Interpolation (SoundTouch PeakFinder):
 *     Applies quadratic/parabolic peak interpolation around the dominant autocorrelation
 *     maximum to extract continuous fractional lag, yielding accurate decimal BPM
 *     (e.g., 128.00, 127.50, 124.00, 174.00).
 *
 *  5. Mixxx Constant-Tempo BeatGrid Phase Alignment:
 *     Correlates uniform beat-grid phase candidates against the kick onset envelope
 *     across the track to find the optimal global phase offset.
 *
 *  6. Mixxx Downbeat Anchor (First Beat / Bar 1):
 *     Scans candidate beat positions starting from the audio intro to locate the
 *     first genuine kick drum transient drop, anchoring Bar 1 (Beat 1) directly to it.
 */
import { getOrInitEssentia } from './essentia-loader'

export async function analyzeBeatGrid(
  buffer: AudioBuffer,
  hintBpm?: number
): Promise<BeatGrid | null> {
  if (buffer.duration < 4) return null
  try {
    const qmGrid = await analyzeQueenMaryBeatGrid(buffer, hintBpm)
    if (qmGrid) return qmGrid
  } catch (err) {
    console.warn('Queen Mary beatgrid analyzer error, fallback to onset engine:', err)
  }

  try {
    await new Promise(r => setTimeout(r, 0))
    return analyze(buffer, hintBpm)
  } catch (err) {
    console.warn('Mixxx beatgrid analyzer error:', err)
    return null
  }
}

interface ConstRegion {
  firstBeat: number
  beatLength: number
}

const K_MAX_SECS_PHASE_ERROR = 0.025
const K_MAX_SECS_PHASE_ERROR_SUM = 0.1
const K_MAX_OUTLIERS_COUNT = 1
const K_MIN_REGION_BEAT_COUNT = 16

/**
 * Mixxx BeatUtils::retrieveConstRegions
 * Irons coarse beat ticks by grouping stable constant tempo regions within 25ms tolerance.
 */
function retrieveConstRegions(beats: number[]): ConstRegion[] {
  if (beats.length < 2) return []
  const constantRegions: ConstRegion[] = []
  let leftIndex = 0
  let rightIndex = beats.length - 1

  while (leftIndex < beats.length - 1) {
    const meanBeatLength = (beats[rightIndex] - beats[leftIndex]) / (rightIndex - leftIndex)
    let outliersCount = 0
    let ironedBeat = beats[leftIndex]
    let phaseErrorSum = 0
    let i = leftIndex + 1

    for (; i <= rightIndex; ++i) {
      ironedBeat += meanBeatLength
      const phaseError = ironedBeat - beats[i]
      phaseErrorSum += phaseError
      if (Math.abs(phaseError) > K_MAX_SECS_PHASE_ERROR) {
        outliersCount++
        if (outliersCount > K_MAX_OUTLIERS_COUNT || i === leftIndex + 1) {
          break
        }
      }
      if (Math.abs(phaseErrorSum) > K_MAX_SECS_PHASE_ERROR_SUM) {
        break
      }
    }

    if (i > rightIndex) {
      let regionBorderError = 0
      if (rightIndex > leftIndex + 2) {
        const firstBeatLength = beats[leftIndex + 1] - beats[leftIndex]
        const lastBeatLength = beats[rightIndex] - beats[rightIndex - 1]
        regionBorderError = Math.abs(firstBeatLength + lastBeatLength - 2 * meanBeatLength)
      }
      if (regionBorderError < K_MAX_SECS_PHASE_ERROR / 2) {
        constantRegions.push({
          firstBeat: beats[leftIndex],
          beatLength: meanBeatLength,
        })
        leftIndex = rightIndex
        rightIndex = beats.length - 1
        continue
      }
    }
    rightIndex--
  }
  constantRegions.push({ firstBeat: beats[beats.length - 1], beatLength: 0 })
  return constantRegions
}

function trySnap(minBpm: number, centerBpm: number, maxBpm: number, fraction: number): number | null {
  const snapBpm = Math.round(centerBpm * fraction) / fraction
  if (snapBpm > minBpm && snapBpm < maxBpm) {
    return snapBpm
  }
  return null
}

/**
 * Mixxx BeatUtils::roundBpmWithinRange
 * Tests snapping to integer, 0.5, 1/3, or 1/12 BPM if it falls within measurement uncertainty.
 */
function roundBpmWithinRange(minBpm: number, centerBpm: number, maxBpm: number): number {
  if (minBpm <= 0 || centerBpm <= 0 || maxBpm <= 0) return centerBpm
  let snap = trySnap(minBpm, centerBpm, maxBpm, 1.0)
  if (snap !== null) return snap

  if (centerBpm < 85.0) {
    snap = trySnap(minBpm, centerBpm, maxBpm, 2.0)
    if (snap !== null) return snap
  }
  if (centerBpm > 127.0) {
    snap = trySnap(minBpm, centerBpm, maxBpm, 2.0 / 3.0)
    if (snap !== null) return snap
  }
  snap = trySnap(minBpm, centerBpm, maxBpm, 3.0)
  if (snap !== null) return snap

  snap = trySnap(minBpm, centerBpm, maxBpm, 12.0)
  if (snap !== null) return snap

  return centerBpm
}

/**
 * Mixxx BeatUtils::makeConstBpm
 * Finds the longest constant region, tests extensions, and calculates constant BPM & initial phase anchor.
 */
function makeConstBpm(
  constantRegions: ConstRegion[]
): { roundBpm: number; rawFirstBeat: number; firstRegionBeat: number } | null {
  if (constantRegions.length < 2) return null

  let midRegionIndex = 0
  let longestRegionLength = 0
  let longestRegionBeatLength = 0

  for (let i = 0; i < constantRegions.length - 1; ++i) {
    const len = constantRegions[i + 1].firstBeat - constantRegions[i].firstBeat
    if (len > longestRegionLength) {
      longestRegionLength = len
      longestRegionBeatLength = constantRegions[i].beatLength
      midRegionIndex = i
    }
  }

  if (longestRegionLength === 0 || longestRegionBeatLength <= 0) return null

  let longestRegionNumberOfBeats = Math.round(longestRegionLength / longestRegionBeatLength)
  let longestRegionBeatLengthMin = longestRegionBeatLength - K_MAX_SECS_PHASE_ERROR / longestRegionNumberOfBeats
  let longestRegionBeatLengthMax = longestRegionBeatLength + K_MAX_SECS_PHASE_ERROR / longestRegionNumberOfBeats
  let startRegionIndex = midRegionIndex

  // Extend forward to intro
  for (let i = 0; i < midRegionIndex; ++i) {
    const len = constantRegions[i + 1].firstBeat - constantRegions[i].firstBeat
    const numBeats = Math.round(len / constantRegions[i].beatLength)
    if (numBeats < K_MIN_REGION_BEAT_COUNT) continue

    const thisMin = constantRegions[i].beatLength - K_MAX_SECS_PHASE_ERROR / numBeats
    const thisMax = constantRegions[i].beatLength + K_MAX_SECS_PHASE_ERROR / numBeats
    if (longestRegionBeatLength > thisMin && longestRegionBeatLength < thisMax) {
      const newLen = constantRegions[midRegionIndex + 1].firstBeat - constantRegions[i].firstBeat
      const bMin = Math.max(longestRegionBeatLengthMin, thisMin)
      const bMax = Math.min(longestRegionBeatLengthMax, thisMax)
      const maxN = Math.round(newLen / bMin)
      const minN = Math.round(newLen / bMax)
      if (minN !== maxN) continue
      const newB = newLen / minN
      if (newB > longestRegionBeatLengthMin && newB < longestRegionBeatLengthMax) {
        longestRegionLength = newLen
        longestRegionBeatLength = newB
        longestRegionNumberOfBeats = minN
        longestRegionBeatLengthMin = longestRegionBeatLength - K_MAX_SECS_PHASE_ERROR / minN
        longestRegionBeatLengthMax = longestRegionBeatLength + K_MAX_SECS_PHASE_ERROR / minN
        startRegionIndex = i
        break
      }
    }
  }

  // Extend backward to outro
  for (let i = constantRegions.length - 2; i > midRegionIndex; --i) {
    const len = constantRegions[i + 1].firstBeat - constantRegions[i].firstBeat
    const numBeats = Math.round(len / constantRegions[i].beatLength)
    if (numBeats < K_MIN_REGION_BEAT_COUNT) continue

    const thisMin = constantRegions[i].beatLength - K_MAX_SECS_PHASE_ERROR / numBeats
    const thisMax = constantRegions[i].beatLength + K_MAX_SECS_PHASE_ERROR / numBeats
    if (longestRegionBeatLength > thisMin && longestRegionBeatLength < thisMax) {
      const newLen = constantRegions[i + 1].firstBeat - constantRegions[startRegionIndex].firstBeat
      const bMin = Math.max(longestRegionBeatLengthMin, thisMin)
      const bMax = Math.min(longestRegionBeatLengthMax, thisMax)
      const maxN = Math.round(newLen / bMin)
      const minN = Math.round(newLen / bMax)
      if (minN !== maxN) continue
      const newB = newLen / minN
      if (newB > longestRegionBeatLengthMin && newB < longestRegionBeatLengthMax) {
        longestRegionLength = newLen
        longestRegionBeatLength = newB
        longestRegionNumberOfBeats = minN
        break
      }
    }
  }

  longestRegionBeatLengthMin = longestRegionBeatLength - K_MAX_SECS_PHASE_ERROR / longestRegionNumberOfBeats
  longestRegionBeatLengthMax = longestRegionBeatLength + K_MAX_SECS_PHASE_ERROR / longestRegionNumberOfBeats

  const minRoundBpm = 60.0 / longestRegionBeatLengthMax
  const maxRoundBpm = 60.0 / longestRegionBeatLengthMin
  const centerBpm = 60.0 / longestRegionBeatLength
  const roundBpm = roundBpmWithinRange(minRoundBpm, centerBpm, maxRoundBpm)

  const roundedBeatLength = 60.0 / roundBpm
  const rawFirstBeat = positiveMod(constantRegions[startRegionIndex].firstBeat, roundedBeatLength)

  return { roundBpm, rawFirstBeat, firstRegionBeat: constantRegions[startRegionIndex].firstBeat }
}

/**
 * Mixxx BeatUtils::adjustPhase
 * Aligns the constant tempo beatgrid phase against the actual detected Queen Mary beat ticks.
 */
function adjustPhase(firstBeat: number, bpm: number, beats: number[]): number {
  if (bpm <= 0 || beats.length === 0) return firstBeat
  const beatLength = 60.0 / bpm
  const startOffset = positiveMod(firstBeat, beatLength)
  let offsetAdjust = 0
  let offsetAdjustCount = 0

  for (const b of beats) {
    let offset = positiveMod(b - startOffset, beatLength)
    if (offset > beatLength / 2) offset -= beatLength
    if (Math.abs(offset) < K_MAX_SECS_PHASE_ERROR) {
      offsetAdjust += offset
      offsetAdjustCount++
    }
  }
  if (offsetAdjustCount > 0) offsetAdjust /= offsetAdjustCount
  return positiveMod(firstBeat + offsetAdjust, beatLength)
}

/**
 * Queen Mary Tempo and Beat Tracker (Degara) with "Assume constant tempo"
 * as recommended in Mixxx.
 */
async function analyzeQueenMaryBeatGrid(
  buffer: AudioBuffer,
  _hintBpm?: number
): Promise<BeatGrid | null> {
  const essentia = await getOrInitEssentia()
  if (!essentia) return null

  // Downmix to mono Float32Array
  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0
  const mono = new Float32Array(ch0.length)
  for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5

  // Essentia WASM's Queen Mary RhythmExtractor2013 internally assumes 44.1 kHz.
  // When running in a browser with a 48 kHz hardware context (Windows default),
  // resample to 44.1 kHz to prevent the apparent tempo from being scaled down by 44.1/48 (e.g. 160 -> 146.85).
  let mono44 = mono
  if (buffer.sampleRate !== 44100) {
    const targetLen = Math.floor((mono.length * 44100) / buffer.sampleRate)
    mono44 = new Float32Array(targetLen)
    const ratio = buffer.sampleRate / 44100
    for (let i = 0; i < targetLen; i++) {
      const src = i * ratio
      const i0 = Math.floor(src)
      const i1 = Math.min(i0 + 1, mono.length - 1)
      const frac = src - i0
      mono44[i] = mono[i0] + (mono[i1] - mono[i0]) * frac
    }
  }

  // Run Queen Mary / Degara RhythmExtractor2013 on 44.1 kHz mono
  const signalVector = essentia.arrayToVector(mono44)
  let rawBpm = 0
  let rawTicks: number[] = []
  try {
    const qm = essentia.RhythmExtractor2013(signalVector, 208, 'degara', 40)
    rawBpm = Number(qm.bpm) || 0
    if (qm.ticks) {
      const arr = essentia.vectorToArray(qm.ticks)
      rawTicks = Array.from(arr)
    }
    qm.ticks?.delete?.()
    qm.estimates?.delete?.()
    qm.bpmIntervals?.delete?.()
  } finally {
    signalVector.delete?.()
  }

  // Cross-validate with Mixxx multi-band kick autocorrelation detector (which runs at true buffer.sampleRate)
  const mixxxBpm = detectMixxxBpmFromPcm(mono, buffer.sampleRate, _hintBpm)

  if ((!rawBpm || rawBpm <= 0) && (!mixxxBpm || mixxxBpm <= 0)) return null

  // Process Queen Mary beats through Mixxx's exact BeatUtils (Assume constant tempo)
  let bpm = rawBpm || mixxxBpm || 120
  let phaseSec = 0

  if (rawTicks.length >= 2) {
    const constantRegions = retrieveConstRegions(rawTicks)
    const constRes = makeConstBpm(constantRegions)
    if (constRes && constRes.roundBpm > 0) {
      bpm = constRes.roundBpm
      phaseSec = adjustPhase(constRes.rawFirstBeat, bpm, rawTicks)
    } else {
      const avgInterval = (rawTicks[rawTicks.length - 1] - rawTicks[0]) / (rawTicks.length - 1)
      if (avgInterval > 0) {
        const estBpm = 60 / avgInterval
        bpm = roundBpmWithinRange(estBpm - 0.5, estBpm, estBpm + 0.5)
        phaseSec = adjustPhase(positiveMod(rawTicks[0], 60 / bpm), bpm, rawTicks)
      }
    }
  }

  // Check against Mixxx kick detector for octave ambiguities or syncopation (e.g. Catscan / gabber)
  if (mixxxBpm && mixxxBpm > 0) {
    if (Math.abs(bpm * 2 - mixxxBpm) < 1) {
      bpm = Math.round(mixxxBpm)
    } else if (Math.abs(bpm / 2 - mixxxBpm) < 1) {
      bpm = Math.round(mixxxBpm)
    } else if (Math.abs(bpm - mixxxBpm) > 1.0) {
      const roundedMixxx = Math.round(mixxxBpm)
      if (Math.abs(mixxxBpm - roundedMixxx) <= 0.25) {
        bpm = roundedMixxx
      } else {
        bpm = Math.round(mixxxBpm * 100) / 100
      }
    }
  }

  const beatSec = 60 / bpm

  // Fallback kick flux phase alignment if rawTicks were sparse or missing
  if (phaseSec <= 0) {
    const decim = buffer.sampleRate >= 32000 ? 2 : 1
    const sr = buffer.sampleRate / decim
    const scanSeconds = Math.min(buffer.duration, 90)
    const monoLen = Math.floor(scanSeconds * sr)
    const monoResampled = new Float32Array(monoLen)
    for (let i = 0; i < monoLen; i++) {
      const idx = decim === 2 ? 2 * i : i
      monoResampled[i] = idx < mono.length ? mono[idx] : 0
    }

    const frames = Math.floor((monoLen - WIN) / HOP)
    if (frames >= 256) {
      const envRate = sr / HOP
      const fft = makeFft(WIN)
      const hann = new Float32Array(WIN)
      for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN)
      const re = new Float32Array(WIN)
      const im = new Float32Array(WIN)
      const binHz = sr / WIN
      const lowBinStart = Math.max(1, Math.floor(35 / binHz))
      const lowBinEnd = Math.floor(180 / binHz)
      const midBinEnd = Math.floor(1500 / binHz)
      const highBinEnd = Math.min(WIN / 2 - 1, Math.floor(8000 / binHz))

      const kickFlux = new Float32Array(frames)
      const totalFlux = new Float32Array(frames)
      let prevLowMag = 0, prevMidMag = 0, prevHighMag = 0

      for (let f = 0; f < frames; f++) {
        const base = f * HOP
        for (let i = 0; i < WIN; i++) re[i] = monoResampled[base + i] * hann[i]
        im.fill(0)
        fft(re, im)
        let lowMag = 0, midMag = 0, highMag = 0
        for (let k = lowBinStart; k <= lowBinEnd; k++) lowMag += Math.sqrt(re[k] * re[k] + im[k] * im[k])
        for (let k = lowBinEnd + 1; k <= midBinEnd; k++) midMag += Math.sqrt(re[k] * re[k] + im[k] * im[k])
        for (let k = midBinEnd + 1; k <= highBinEnd; k++) highMag += Math.sqrt(re[k] * re[k] + im[k] * im[k])
        const lowLog = Math.log1p(lowMag)
        const midLog = Math.log1p(midMag)
        const highLog = Math.log1p(highMag)
        const dLow = Math.max(0, lowLog - prevLowMag)
        const dMid = Math.max(0, midLog - prevMidMag)
        const dHigh = Math.max(0, highLog - prevHighMag)
        prevLowMag = lowLog; prevMidMag = midLog; prevHighMag = highLog
        kickFlux[f] = dLow
        totalFlux[f] = 2.5 * dLow + 1.0 * dMid + 0.6 * dHigh
      }

      const filterHalf = Math.max(2, Math.round(envRate * 0.06))
      subtractMovingMean(kickFlux, filterHalf)
      subtractMovingMean(totalFlux, filterHalf)

      const beatFrames = beatSec * envRate
      const numPhaseSteps = Math.round(beatFrames)
      let bestPhaseFrame = 0
      let maxPhaseScore = -1

      for (let p = 0; p < numPhaseSteps; p++) {
        let score = 0
        let count = 0
        for (let frame = p; frame < frames; frame += beatFrames) {
          const idx = Math.round(frame)
          if (idx < frames) {
            score += 2.5 * kickFlux[idx] + totalFlux[idx]
            count++
          }
        }
        const avgScore = count > 0 ? score / count : 0
        if (avgScore > maxPhaseScore) {
          maxPhaseScore = avgScore
          bestPhaseFrame = p
        }
      }

      phaseSec = (bestPhaseFrame * HOP + WIN / 2) / sr
    }
  }

  // Locate the actual first kick downbeat from the audio intro (Bar 1 downbeat anchor)
  const firstBarTime = findMixxxFirstBeatAtIntro(buffer, bpm, phaseSec)
  return {
    bpm,
    firstBar: firstBarTime,
    firstBeat: positiveMod(firstBarTime, beatSec),
    beatsPerBar: BEATS_PER_BAR,
  }
}

const WIN = 1024
const HOP = 128 // ~5.8ms frame resolution at 22.05 kHz for razor-sharp transient timing
const MIN_BPM = 65
const MAX_BPM = 195
const BEATS_PER_BAR = 4
const ANALYSIS_SECONDS = 120

function analyze(buffer: AudioBuffer, hintBpm?: number): BeatGrid | null {
  if (buffer.duration < 4) return null

  // 1. Take up to 90 seconds from the clearest/loudest rhythmic section of the track
  const decim = buffer.sampleRate >= 32000 ? 2 : 1
  const sr = buffer.sampleRate / decim
  const winSamples = Math.min(buffer.length, Math.floor(buffer.sampleRate * ANALYSIS_SECONDS))
  const startSample = loudestWindowStart(buffer, winSamples)
  const monoLen = Math.floor(winSamples / decim)
  const mono = new Float32Array(monoLen)

  {
    const tmp = new Float32Array(winSamples)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      buffer.copyFromChannel(tmp, ch, startSample)
      if (decim === 2) {
        for (let i = 0; i < monoLen; i++) {
          mono[i] += (tmp[2 * i] + tmp[2 * i + 1]) / (2 * buffer.numberOfChannels)
        }
      } else {
        for (let i = 0; i < monoLen; i++) {
          mono[i] += tmp[i] / buffer.numberOfChannels
        }
      }
    }
  }

  // 2. Multi-band Onset Detection Function (ODF) via STFT
  const frames = Math.floor((monoLen - WIN) / HOP)
  if (frames < 256) return null
  const envRate = sr / HOP

  const fft = makeFft(WIN)
  const hann = new Float32Array(WIN)
  for (let i = 0; i < WIN; i++) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN)
  }
  const re = new Float32Array(WIN)
  const im = new Float32Array(WIN)

  const binHz = sr / WIN
  // Mixxx / Queen Mary sub-bands:
  // Low (Kick): 35 - 180 Hz
  // Mid (Snare/synth): 180 - 1500 Hz
  // High (Hi-hats): 1500 - 8000 Hz
  const lowBinStart = Math.max(1, Math.floor(35 / binHz))
  const lowBinEnd = Math.floor(180 / binHz)
  const midBinEnd = Math.floor(1500 / binHz)
  const highBinEnd = Math.min(WIN / 2 - 1, Math.floor(8000 / binHz))

  const kickFlux = new Float32Array(frames)
  const totalFlux = new Float32Array(frames)

  let prevLowMag = 0
  let prevMidMag = 0
  let prevHighMag = 0

  for (let f = 0; f < frames; f++) {
    const base = f * HOP
    for (let i = 0; i < WIN; i++) re[i] = mono[base + i] * hann[i]
    im.fill(0)
    fft(re, im)

    let lowMag = 0
    for (let k = lowBinStart; k <= lowBinEnd; k++) {
      lowMag += Math.sqrt(re[k] * re[k] + im[k] * im[k])
    }
    let midMag = 0
    for (let k = lowBinEnd + 1; k <= midBinEnd; k++) {
      midMag += Math.sqrt(re[k] * re[k] + im[k] * im[k])
    }
    let highMag = 0
    for (let k = midBinEnd + 1; k <= highBinEnd; k++) {
      highMag += Math.sqrt(re[k] * re[k] + im[k] * im[k])
    }

    const lowLog = Math.log1p(lowMag)
    const midLog = Math.log1p(midMag)
    const highLog = Math.log1p(highMag)

    const dLow = Math.max(0, lowLog - prevLowMag)
    const dMid = Math.max(0, midLog - prevMidMag)
    const dHigh = Math.max(0, highLog - prevHighMag)

    prevLowMag = lowLog
    prevMidMag = midLog
    prevHighMag = highLog

    kickFlux[f] = dLow
    // Low band has 2.5x weight because 4/4 kick drums define DJ beatgrids
    totalFlux[f] = 2.5 * dLow + 1.0 * dMid + 0.6 * dHigh
  }

  // 3. Adaptive Background Suppression (moving average subtraction, ~120ms window)
  const filterHalf = Math.max(2, Math.round(envRate * 0.06))
  subtractMovingMean(kickFlux, filterHalf)
  subtractMovingMean(totalFlux, filterHalf)

  // 4. Autocorrelation across the lag range
  const minLag = Math.floor((envRate * 60) / MAX_BPM)
  const maxLag = Math.ceil((envRate * 60) / MIN_BPM)
  const maxAcfLag = maxLag * 3 + 4
  const acf = new Float32Array(maxAcfLag)

  for (let lag = minLag; lag < maxAcfLag; lag++) {
    const n = frames - lag
    if (n < 64) break
    let s = 0
    for (let i = 0; i < n; i++) s += totalFlux[i] * totalFlux[i + lag]
    acf[lag] = s / n
  }

  const acfAt = (lag: number) => {
    const i = Math.round(lag)
    return i >= 0 && i < acf.length ? acf[i] : 0
  }

  // Mixxx DJ dance tempo prior centered at 125 BPM
  const prior = (bpm: number) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.40, 2))

  // Comb filter harmonic sum
  const scoreAt = (lag: number) => {
    const bpm = (60 * envRate) / lag
    const base = acfAt(lag)
    const harm2 = acfAt(lag * 2)
    const harm3 = acfAt(lag * 3)
    const harmHalf = acfAt(lag / 2)
    let s = (base + 0.6 * harm2 + 0.3 * harm3 + 0.35 * harmHalf) * (0.35 + 0.65 * prior(bpm))
    if (hintBpm && Math.abs(bpm - hintBpm) / hintBpm < 0.04) {
      s *= 1.35
    }
    return s
  }

  // 5. Candidate peak picking & SoundTouch PeakFinder parabolic interpolation
  const peaks: { lag: number; score: number }[] = []
  for (let lag = minLag + 1; lag < maxLag - 1; lag++) {
    const s = scoreAt(lag)
    if (s > scoreAt(lag - 1) && s >= scoreAt(lag + 1)) {
      peaks.push({ lag, score: s })
    }
  }
  peaks.sort((a, b) => b.score - a.score)

  if (peaks.length === 0) return null

  const topLag = peaks[0].lag
  const y0 = scoreAt(topLag - 1)
  const y1 = scoreAt(topLag)
  const y2 = scoreAt(topLag + 1)
  const denom = 2 * (y0 - 2 * y1 + y2)
  let delta = 0
  if (denom < -1e-6) {
    delta = (y0 - y2) / denom
    delta = Math.max(-0.5, Math.min(0.5, delta))
  }
  let continuousLag = topLag + delta

  // Fundamental period check: If half-lag (double tempo) has strong resonance,
  // it is the true fundamental beat rate (e.g., 174 BPM instead of 87 BPM)
  const halfLag = Math.round(continuousLag / 2)
  if (halfLag >= minLag) {
    const sHalf = scoreAt(halfLag)
    const sFull = scoreAt(Math.round(continuousLag))
    if (sHalf >= 0.55 * sFull) {
      continuousLag = continuousLag / 2
    }
  }

  let detectedBpm = (60 * envRate) / continuousLag

  // Octave sanity check: normalize to primary DJ dance range [100, 165]
  if (detectedBpm < 85 && detectedBpm * 2 <= MAX_BPM) {
    detectedBpm *= 2
  } else if (detectedBpm > 185 && detectedBpm / 2 >= MIN_BPM) {
    detectedBpm /= 2
  }

  const finalBpm = Math.round(detectedBpm * 100) / 100
  const beatSec = 60 / finalBpm
  const beatFrames = beatSec * envRate

  // 6. Mixxx BeatGrid Phase Alignment:
  // Correlate candidate grid phases [0, beatFrames) with kick flux peaks across the window
  const numPhaseSteps = Math.round(beatFrames)
  let bestPhaseFrame = 0
  let maxPhaseScore = -1

  for (let p = 0; p < numPhaseSteps; p++) {
    let score = 0
    let count = 0
    for (let frame = p; frame < frames; frame += beatFrames) {
      const idx = Math.round(frame)
      if (idx < frames) {
        score += 2.5 * kickFlux[idx] + totalFlux[idx]
        count++
      }
    }
    const avgScore = count > 0 ? score / count : 0
    if (avgScore > maxPhaseScore) {
      maxPhaseScore = avgScore
      bestPhaseFrame = p
    }
  }

  // Convert best phase frame relative to buffer start
  const windowStartSec = startSample / buffer.sampleRate
  const phaseSec = windowStartSec + (bestPhaseFrame * HOP + WIN / 2) / sr

  // 7. Mixxx First Beat / Bar 1 Anchor:
  // Locate the actual first kick downbeat from the audio intro (first 30 seconds)
  const firstBarTime = findMixxxFirstBeatAtIntro(buffer, finalBpm, phaseSec)

  return {
    bpm: finalBpm,
    firstBeat: positiveMod(firstBarTime, beatSec),
    firstBar: firstBarTime,
    beatsPerBar: BEATS_PER_BAR,
  }
}

/**
 * Mixxx-style First Beat Locator:
 * Evaluates candidate grid beats starting from the audio file intro (first 30s)
 * along the established grid phase, measuring kick drum transient strength.
 * Anchors Beat 1 (Bar 1) to the first prominent kick drum drop.
 */
function findMixxxFirstBeatAtIntro(
  buffer: AudioBuffer,
  bpm: number,
  establishedPhaseSec: number
): number {
  const beatSec = 60 / bpm
  const sr = buffer.sampleRate
  const scanSeconds = Math.min(buffer.duration, 30)
  const scanSamples = Math.floor(scanSeconds * sr)
  if (scanSamples <= 0) return positiveMod(establishedPhaseSec, beatSec)

  // Downmix intro section to mono
  const intro = new Float32Array(scanSamples)
  const tmp = new Float32Array(scanSamples)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    buffer.copyFromChannel(tmp, ch, 0)
    for (let i = 0; i < scanSamples; i++) {
      intro[i] += tmp[i] / buffer.numberOfChannels
    }
  }

  // 2nd-order lowpass filter (Butterworth, fc = 160 Hz) to isolate kick drum fundamental
  // This filters out vocal intros, synth melodies, vinyl noise, and hi-hats
  const fc = 160
  const w0 = (2 * Math.PI * fc) / sr
  const alpha = Math.sin(w0) / (2 * 0.707)
  const cosw0 = Math.cos(w0)
  const b0 = (1 - cosw0) / 2
  const b1 = 1 - cosw0
  const b2 = (1 - cosw0) / 2
  const a0 = 1 + alpha
  const a1 = -2 * cosw0
  const a2 = 1 - alpha

  const invA0 = 1 / a0
  const cB0 = b0 * invA0
  const cB1 = b1 * invA0
  const cB2 = b2 * invA0
  const cA1 = a1 * invA0
  const cA2 = a2 * invA0

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  const filtered = new Float32Array(scanSamples)
  for (let i = 0; i < scanSamples; i++) {
    const x0 = intro[i]
    const y0 = cB0 * x0 + cB1 * x1 + cB2 * x2 - cA1 * y1 - cA2 * y2
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
    filtered[i] = y0
  }

  // 1. Detect first audio onset above silence (RMS > 0.005)
  const block10ms = Math.floor(sr * 0.01)
  const num10msBlocks = Math.floor(scanSamples / block10ms)
  let audioStartSec = 0
  for (let b = 0; b < num10msBlocks; b++) {
    let s = 0
    const base = b * block10ms
    for (let i = 0; i < block10ms; i += 2) {
      const v = intro[base + i]
      s += v * v
    }
    const rms = Math.sqrt(s / (block10ms / 2))
    if (rms > 0.005) {
      audioStartSec = (b * block10ms) / sr
      break
    }
  }

  // 2. Short 20ms windowed kick energy
  const blockSize = Math.floor(sr * 0.02)
  const numBlocks = Math.floor(scanSamples / blockSize)
  const kickEnergy = new Float32Array(numBlocks)

  for (let b = 0; b < numBlocks; b++) {
    let s = 0
    const base = b * blockSize
    for (let i = 0; i < blockSize; i += 2) {
      const v = filtered[base + i]
      s += v * v
    }
    kickEnergy[b] = s
  }

  // Find candidate grid beats starting at time positiveMod(establishedPhaseSec, beatSec)
  const phase0 = positiveMod(establishedPhaseSec, beatSec)
  const maxBeats = Math.floor(scanSeconds / beatSec)
  const beatEnergies: number[] = []

  for (let k = 0; k < maxBeats; k++) {
    const t = phase0 + k * beatSec
    const centerBlock = Math.round((t * sr) / blockSize)
    let e = 0
    for (let w = -2; w <= 2; w++) {
      const idx = centerBlock + w
      if (idx >= 0 && idx < numBlocks) {
        e = Math.max(e, kickEnergy[idx])
      }
    }
    beatEnergies.push(e)
  }

  // 1. Determine downbeat rotation among the 4 bar phases (0, 1, 2, 3)
  // Scores each candidate rotation against low-frequency kick drum energy across all bars.
  // In 4/4 electronic, dance and popular music, Beat 1 has the primary downbeat kick & crash.
  const rotationScores = [0, 0, 0, 0]
  const rotationCounts = [0, 0, 0, 0]
  for (let k = 0; k < beatEnergies.length; k++) {
    const r = k % 4
    rotationScores[r] += beatEnergies[k]
    rotationCounts[r]++
  }

  let bestRotation = 0
  let bestRotScore = -1
  for (let r = 0; r < 4; r++) {
    const avg = rotationCounts[r] > 0 ? rotationScores[r] / rotationCounts[r] : 0
    if (avg > bestRotScore) {
      bestRotScore = avg
      bestRotation = r
    }
  }

  // 2. Locate the first authentic downbeat where the music / rhythm drops
  let maxKick = 0
  for (const e of beatEnergies) {
    if (e > maxKick) maxKick = e
  }

  // Find the first downbeat candidate (k % 4 === bestRotation) that coincides with the kick drop
  let firstBarBeatIdx = -1
  const kickDropThreshold = maxKick * 0.20

  for (let k = 0; k < maxBeats; k++) {
    if (k % 4 !== bestRotation) continue
    const t = phase0 + k * beatSec
    if (t < audioStartSec - 0.06) continue

    // If this candidate downbeat has substantial kick energy, it's the rhythm drop!
    if (beatEnergies[k] >= kickDropThreshold) {
      firstBarBeatIdx = k
      break
    }
  }

  // Fallback: if intro is very soft/drumless, pick the first downbeat candidate after audio starts
  if (firstBarBeatIdx === -1) {
    for (let k = 0; k < maxBeats; k++) {
      if (k % 4 !== bestRotation) continue
      const t = phase0 + k * beatSec
      if (t >= audioStartSec - 0.06) {
        firstBarBeatIdx = k
        break
      }
    }
  }

  if (firstBarBeatIdx === -1) {
    firstBarBeatIdx = bestRotation
  }

  // Anchor Bar 1 (white downbeat stripe) to the authentic downbeat of the track
  const firstBarTime = Math.max(0, phase0 + firstBarBeatIdx * beatSec)
  return firstBarTime
}

/**
 * Local moving average subtraction to eliminate sustained pads and drones,
 * highlighting sudden transient drum attacks.
 */
function subtractMovingMean(x: Float32Array, half: number) {
  const n = x.length
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i]
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n, i + half + 1)
    const mean = (prefix[b] - prefix[a]) / (b - a)
    x[i] = Math.max(0, x[i] - mean)
  }
}

/**
 * Finds the starting sample of the loudest analysis window in the track.
 */
function loudestWindowStart(buffer: AudioBuffer, length: number): number {
  if (length >= buffer.length) return 0
  const data = buffer.getChannelData(0)
  const block = Math.floor(buffer.sampleRate)
  const blocks = Math.floor(buffer.length / block)
  const energy = new Float32Array(blocks)
  for (let b = 0; b < blocks; b++) {
    let s = 0
    const base = b * block
    for (let i = 0; i < block; i += 16) s += data[base + i] * data[base + i]
    energy[b] = s
  }
  const windowBlocks = Math.max(1, Math.floor(length / block))
  let sum = 0
  for (let b = 0; b < Math.min(windowBlocks, blocks); b++) sum += energy[b]
  let bestSum = sum
  let bestStart = 0
  for (let b = windowBlocks; b < blocks; b++) {
    sum += energy[b] - energy[b - windowBlocks]
    if (sum > bestSum) {
      bestSum = sum
      bestStart = b - windowBlocks + 1
    }
  }
  return bestStart * block
}

/**
 * Standalone Mixxx BPM detector operating directly on a mono Float32Array PCM buffer.
 */
export function detectMixxxBpmFromPcm(
  monoAudio: Float32Array,
  sampleRate: number,
  hintBpm?: number
): number | null {
  if (monoAudio.length < sampleRate * 3) return null

  const decim = sampleRate >= 32000 ? 2 : 1
  const sr = sampleRate / decim
  const maxSec = 90
  const maxSamples = Math.min(monoAudio.length, Math.floor(sampleRate * maxSec))

  // Find loudest window or take center slice
  let start = 0
  const block = Math.floor(sampleRate)
  const blocks = Math.floor(monoAudio.length / block)
  if (blocks > maxSec) {
    const energy = new Float32Array(blocks)
    for (let b = 0; b < blocks; b++) {
      let s = 0
      const base = b * block
      for (let i = 0; i < block; i += 16) s += monoAudio[base + i] * monoAudio[base + i]
      energy[b] = s
    }
    const winBlocks = maxSec
    let sum = 0
    for (let b = 0; b < winBlocks; b++) sum += energy[b]
    let bestSum = sum
    let bestStart = 0
    for (let b = winBlocks; b < blocks; b++) {
      sum += energy[b] - energy[b - winBlocks]
      if (sum > bestSum) {
        bestSum = sum
        bestStart = b - winBlocks + 1
      }
    }
    start = bestStart * block
  }
  start = Math.max(0, Math.min(start, Math.max(0, monoAudio.length - maxSamples)))
  const monoLen = Math.floor(maxSamples / decim)
  const mono = new Float32Array(monoLen)
  if (decim === 2) {
    for (let i = 0; i < monoLen; i++) {
      const idx0 = start + 2 * i
      const idx1 = idx0 + 1
      const s0 = idx0 < monoAudio.length ? monoAudio[idx0] : 0
      const s1 = idx1 < monoAudio.length ? monoAudio[idx1] : s0
      mono[i] = (s0 + s1) * 0.5
    }
  } else {
    for (let i = 0; i < monoLen; i++) {
      const idx = start + i
      mono[i] = idx < monoAudio.length ? monoAudio[idx] : 0
    }
  }

  const frames = Math.floor((monoLen - WIN) / HOP)
  if (frames < 256) return null
  const envRate = sr / HOP

  const fft = makeFft(WIN)
  const hann = new Float32Array(WIN)
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN)
  const re = new Float32Array(WIN)
  const im = new Float32Array(WIN)

  const binHz = sr / WIN
  const lowBinStart = Math.max(1, Math.floor(35 / binHz))
  const lowBinEnd = Math.floor(180 / binHz)
  const midBinEnd = Math.floor(1500 / binHz)
  const highBinEnd = Math.min(WIN / 2 - 1, Math.floor(8000 / binHz))

  const totalFlux = new Float32Array(frames)
  let prevLowMag = 0
  let prevMidMag = 0
  let prevHighMag = 0

  for (let f = 0; f < frames; f++) {
    const base = f * HOP
    for (let i = 0; i < WIN; i++) re[i] = mono[base + i] * hann[i]
    im.fill(0)
    fft(re, im)

    let lowMag = 0
    for (let k = lowBinStart; k <= lowBinEnd; k++) lowMag += Math.sqrt(re[k] * re[k] + im[k] * im[k])
    let midMag = 0
    for (let k = lowBinEnd + 1; k <= midBinEnd; k++) midMag += Math.sqrt(re[k] * re[k] + im[k] * im[k])
    let highMag = 0
    for (let k = midBinEnd + 1; k <= highBinEnd; k++) highMag += Math.sqrt(re[k] * re[k] + im[k] * im[k])

    const lowLog = Math.log1p(lowMag)
    const midLog = Math.log1p(midMag)
    const highLog = Math.log1p(highMag)

    const dLow = Math.max(0, lowLog - prevLowMag)
    const dMid = Math.max(0, midLog - prevMidMag)
    const dHigh = Math.max(0, highLog - prevHighMag)

    prevLowMag = lowLog
    prevMidMag = midLog
    prevHighMag = highLog

    totalFlux[f] = 2.5 * dLow + 1.0 * dMid + 0.6 * dHigh
  }

  const filterHalf = Math.max(2, Math.round(envRate * 0.06))
  subtractMovingMean(totalFlux, filterHalf)

  const minLag = Math.floor((envRate * 60) / MAX_BPM)
  const maxLag = Math.ceil((envRate * 60) / MIN_BPM)
  const maxAcfLag = maxLag * 3 + 4
  const acf = new Float32Array(maxAcfLag)

  for (let lag = minLag; lag < maxAcfLag; lag++) {
    const n = frames - lag
    if (n < 64) break
    let s = 0
    for (let i = 0; i < n; i++) s += totalFlux[i] * totalFlux[i + lag]
    acf[lag] = s / n
  }

  const acfAt = (lag: number) => {
    const i = Math.round(lag)
    return i >= 0 && i < acf.length ? acf[i] : 0
  }

  const prior = (bpm: number) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.40, 2))

  const scoreAt = (lag: number) => {
    const bpm = (60 * envRate) / lag
    const base = acfAt(lag)
    const harm2 = acfAt(lag * 2)
    const harm3 = acfAt(lag * 3)
    const harmHalf = acfAt(lag / 2)
    let s = (base + 0.6 * harm2 + 0.3 * harm3 + 0.35 * harmHalf) * (0.35 + 0.65 * prior(bpm))
    if (hintBpm && Math.abs(bpm - hintBpm) / hintBpm < 0.04) {
      s *= 1.35
    }
    return s
  }

  const peaks: { lag: number; score: number }[] = []
  for (let lag = minLag + 1; lag < maxLag - 1; lag++) {
    const s = scoreAt(lag)
    if (s > scoreAt(lag - 1) && s >= scoreAt(lag + 1)) {
      peaks.push({ lag, score: s })
    }
  }
  peaks.sort((a, b) => b.score - a.score)
  if (peaks.length === 0) return null

  const topLag = peaks[0].lag
  const y0 = acfAt(topLag - 1)
  const y1 = acfAt(topLag)
  const y2 = acfAt(topLag + 1)
  const denom = 2 * (y0 - 2 * y1 + y2)
  let delta = 0
  if (denom < -1e-6) {
    delta = (y0 - y2) / denom
    delta = Math.max(-0.5, Math.min(0.5, delta))
  }
  let continuousLag = topLag + delta

  const halfLag = Math.round(continuousLag / 2)
  if (halfLag >= minLag) {
    const sHalf = scoreAt(halfLag)
    const sFull = scoreAt(Math.round(continuousLag))
    if (sHalf >= 0.55 * sFull) continuousLag = continuousLag / 2
  }

  let detectedBpm = (60 * envRate) / continuousLag
  if (detectedBpm < 85 && detectedBpm * 2 <= MAX_BPM) {
    detectedBpm *= 2
  } else if (detectedBpm > 185 && detectedBpm / 2 >= MIN_BPM) {
    detectedBpm /= 2
  }

  return Math.round(detectedBpm * 100) / 100
}

