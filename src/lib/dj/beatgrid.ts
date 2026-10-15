import { positiveMod } from './dsp'
import type { BeatGrid, BeatGridAnalysis } from './types'
import {
  ODF_HOP,
  ODF_WIN,
  computeOnsetEnvelope,
  frameToSeconds,
  suppressBackground,
} from './spectral-flux'
import type { OnsetEnvelope } from './spectral-flux'
import { deriveBpmInterpretation, normalizeDjBpm, trackBeats } from './beat-tracker'

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
 *
 *  7. Variable-Tempo Grid (only when needed):
 *     Turns the tracker's beat ticks into a variable-tempo beat map when no
 *     single tempo fits the track (live drums, disco, funk, vinyl rips). Tracks
 *     that do hold tempo keep the constant grid, and may still take a refined
 *     global BPM from the same ticks. See ./grid.ts.
 */
import { getOrInitEssentia } from './essentia-loader'
import { beatGridFromMap, buildBeatMapFromTicks } from './grid'

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

/**
 * The analyzer's one onset front-end.
 *
 * Every tempo/beat path here used to carry its own copy of a three-band flux
 * loop with hand-tuned weights (`2.5 * low + mid + 0.6 * high`). They now share
 * the log-spaced band envelope from ./spectral-flux, so those weights are gone
 * and there is a single place to fix if onset detection is ever wrong.
 */
function onsetEnvelope(mono: Float32Array, sampleRate: number): OnsetEnvelope | null {
  const env = computeOnsetEnvelope(mono, sampleRate)
  if (!env) return null
  const half = Math.max(2, Math.round(env.envRate * 0.06))
  suppressBackground(env.odf, half)
  suppressBackground(env.lowOdf, half)
  return env
}

/**
 * The kick/bass group, or the full band when a track has no low-end pulse at
 * all. A DJ grid is phase-anchored to the kick, so the low group *is* the
 * reference; falling back to the full band keeps that from being a dead end on
 * material that has no kick drum to align to.
 */
function kickEnvelope(env: OnsetEnvelope): Float32Array {
  let peak = 0
  for (let i = 0; i < env.frames; i++) if (env.lowOdf[i] > peak) peak = env.lowOdf[i]
  return peak > 0 ? env.lowOdf : env.odf
}

/**
 * Frame index of the lattice phase that best matches `envelope`, or -1 when the
 * envelope holds no onset energy to align to.
 */
function bestLatticePhase(envelope: Float32Array, envRate: number, beatSec: number): number {
  const frames = envelope.length
  const beatFrames = beatSec * envRate
  const steps = Math.max(1, Math.round(beatFrames))
  let bestPhase = 0
  let bestScore = -1
  for (let p = 0; p < steps; p++) {
    let score = 0
    let count = 0
    for (let frame = p; frame < frames; frame += beatFrames) {
      const idx = Math.round(frame)
      if (idx < frames) {
        score += envelope[idx]
        count++
      }
    }
    const avg = count > 0 ? score / count : 0
    if (avg > bestScore) {
      bestScore = avg
      bestPhase = p
    }
  }
  return bestScore > 0 ? bestPhase : -1
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
  // The DJ-normalised reading drives the cross-checks exactly as before; the raw
  // measurement and the octave multiplier are kept for provenance.
  const mixxxRaw = detectMixxxRawBpmFromPcm(mono, buffer.sampleRate, _hintBpm)
  const mixxxNorm = mixxxRaw === null ? null : normalizeDjBpm(mixxxRaw, { minBpm: MIN_BPM, maxBpm: MAX_BPM })
  const mixxxBpm = mixxxNorm ? mixxxNorm.bpm : null

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

  // One shared envelope over the intro, used by both the phase fallback and the
  // beat tracker below, so the analyzer pays for one onset pass and never has
  // two onset implementations to keep in step.
  const decim = buffer.sampleRate >= 32000 ? 2 : 1
  const introRate = buffer.sampleRate / decim
  const introLen = Math.min(mono.length, Math.floor(Math.min(buffer.duration, 120) * introRate))
  const introMono = new Float32Array(introLen)
  for (let i = 0; i < introLen; i++) {
    const idx = decim === 2 ? 2 * i : i
    introMono[i] = idx < mono.length ? mono[idx] : 0
  }
  const introEnv = onsetEnvelope(introMono, introRate)

  // Fallback beat phase alignment from the kick group when the tick list was
  // sparse or missing.
  if (phaseSec <= 0 && introEnv && introEnv.frames >= 256) {
    const phaseFrame = bestLatticePhase(kickEnvelope(introEnv), introEnv.envRate, beatSec)
    if (phaseFrame >= 0) phaseSec = frameToSeconds(phaseFrame, introRate, ODF_HOP, ODF_WIN)
  }

  // Ellis-style dynamic-programming beat tracking over the same envelope. This
  // is what lets the grid follow a performance that wobbles — a real drummer, a
  // vinyl rip, a tape-saturated edit — instead of asserting one rigid phase, and
  // its residual is the analyzer's own evidence for how well it did.
  const tracked = introEnv
    ? trackBeats(introEnv.odf, introEnv.envRate, { bpm, minBpm: MIN_BPM, maxBpm: MAX_BPM })
    : null
  const trackedBeats = tracked
    ? tracked.keptFrames.map(f => frameToSeconds(f, introRate, ODF_HOP, ODF_WIN))
    : null

  // Locate the actual first beat / downbeat from the audio intro (Bar 1 downbeat anchor)
  const firstBarTime = findMixxxFirstBeatAtIntro(buffer, bpm, phaseSec, rawTicks)
  const constantGrid: BeatGrid = {
    bpm,
    firstBar: firstBarTime,
    firstBeat: positiveMod(firstBarTime, beatSec),
    beatsPerBar: BEATS_PER_BAR,
  }

  // Provenance: what was measured, what interpretation was applied, which
  // engines contributed, and how well the tracked beats fitted.
  const interpretation = deriveBpmInterpretation(rawBpm || mixxxRaw || bpm, bpm)
  const analysis: BeatGridAnalysis = {
    rawBpm: interpretation.rawBpm,
    bpmMultiplier: interpretation.multiplier,
    bpmSource:
      rawBpm && mixxxRaw
        ? 'essentia-rhythm2013+onset-acf'
        : rawBpm
          ? 'essentia-rhythm2013'
          : 'onset-acf',
    beatSource: tracked ? 'ellis-dp' : 'essentia-degara',
    fitResidual: tracked?.residualLogRms,
    contrast: tracked?.contrast,
    retainedRatio: tracked?.retainedRatio,
    confidence: tracked?.confidence,
  }

  // 7. Variable-tempo check. Tracks that hold one tempo (all machine-timed dance
  //    music) come back with no beat map, so this changes nothing for them — but
  //    when the tracked beats disagree with any single tempo, the measured beat
  //    positions become the grid so the ticks stop sliding on live drums, disco,
  //    funk and vinyl rips. The DP's tracked beats are preferred over the Essentia
  //    tick list because they are measured here, tolerantly, and come with the
  //    residual that says whether they can be trusted.
  const ticks = trackedBeats && trackedBeats.length >= 16 ? trackedBeats : rawTicks
  const withAnalysis = { ...constantGrid, analysis }
  const outcome = buildBeatMapFromTicks(ticks, bpm, phaseSec, buffer.duration)
  if (!outcome) return withAnalysis

  if (!outcome.map) {
    // No map, but the beats may still pin down a better single tempo than the
    // rounded one. Adopt it so a small tempo error is not left to accumulate.
    if (!(outcome.refinedBpm > 0) || Math.abs(outcome.refinedBpm - bpm) < 0.01) {
      return withAnalysis
    }
    const refinedBpm = Math.round(outcome.refinedBpm * 100) / 100
    return {
      ...withAnalysis,
      bpm: refinedBpm,
      firstBeat: positiveMod(firstBarTime, 60 / refinedBpm),
    }
  }

  return { ...beatGridFromMap(constantGrid, outcome.map), analysis: { ...analysis, variable: true } }
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

  // 2. Onset detection over log-spaced bands (shared front-end, see
  //    ./spectral-flux). Bands are summed with equal weight and the low (kick)
  //    group is kept separately, so the previous hand-tuned
  //    `2.5 * low + mid + 0.6 * high` blend is gone.
  const env = onsetEnvelope(mono, sr)
  if (!env) return null
  const frames = env.frames
  const envRate = env.envRate
  const totalFlux = env.odf


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

  const measuredBpm = (60 * envRate) / continuousLag

  // Octave sanity check: normalise to the primary DJ dance range, keeping the
  // measurement and the applied multiplier so the interpretation stays visible
  // and reversible instead of silently overwriting what was detected.
  const normalised = normalizeDjBpm(measuredBpm, { minBpm: MIN_BPM, maxBpm: MAX_BPM })
  const finalBpm = normalised.bpm
  const beatSec = 60 / finalBpm

  // 6. Grid phase alignment: score candidate lattice phases against the kick
  //    group (or the full band when a track has no low-end pulse at all),
  //    instead of a weighted blend of three hand-picked bands.
  const phaseFrame = bestLatticePhase(kickEnvelope(env), envRate, beatSec)
  const bestPhaseFrame = phaseFrame >= 0 ? phaseFrame : 0

  // Convert best phase frame relative to buffer start
  const windowStartSec = startSample / buffer.sampleRate
  const phaseSec = frameToSeconds(bestPhaseFrame, sr, ODF_HOP, ODF_WIN, windowStartSec)

  // 7. Mixxx First Beat / Bar 1 Anchor:
  // Locate the actual first kick downbeat from the audio intro (first 30 seconds)
  const firstBarTime = findMixxxFirstBeatAtIntro(buffer, finalBpm, phaseSec)

  return {
    bpm: finalBpm,
    firstBeat: positiveMod(firstBarTime, beatSec),
    firstBar: firstBarTime,
    beatsPerBar: BEATS_PER_BAR,
    analysis: {
      rawBpm: normalised.rawBpm,
      bpmMultiplier: normalised.multiplier,
      bpmSource: 'onset-acf',
      beatSource: 'constant-lattice',
    },
  }
}

/**
 * Mixxx-style First Beat Locator:
 * Finds the exact first beat onset where the music begins.
 * - Uses STFT low-frequency (35-180 Hz) spectral flux with local background suppression
 *   to isolate kick drum transient attacks from ambient pads, synth swells, and silence.
 * - For tracks with drum intros starting at 0:00 (like J9_lime): anchors directly to the first beat of the intro.
 * - For tracks with ambient/synth swells before a drop (like Lip_rona): detects the exact first beat
 *   where the kick drops (at the red line), avoiding late 1-beat offsets or arbitrary rotation filtering.
 */
function findMixxxFirstBeatAtIntro(
  buffer: AudioBuffer,
  bpm: number,
  establishedPhaseSec: number,
  _rawTicks?: number[]
): number {
  const beatSec = 60 / bpm
  const srOrig = buffer.sampleRate
  const scanSeconds = Math.min(buffer.duration, 35)
  if (scanSeconds <= 0) return positiveMod(establishedPhaseSec, beatSec)

  const decim = srOrig >= 32000 ? 2 : 1
  const sr = srOrig / decim
  const monoLen = Math.floor(scanSeconds * sr)
  if (monoLen < WIN + HOP) return positiveMod(establishedPhaseSec, beatSec)

  // Downmix intro section to mono Float32Array (decimated to ~22.05 kHz)
  const mono = new Float32Array(monoLen)
  {
    const tmp = new Float32Array(monoLen * decim)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      buffer.copyFromChannel(tmp, ch, 0)
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

  // 1. Detect audio onset above silence (RMS > 0.002 in 10ms blocks)
  const block10ms = Math.floor(sr * 0.01)
  const num10msBlocks = Math.floor(monoLen / block10ms)
  let audioStartSec = 0
  for (let b = 0; b < num10msBlocks; b++) {
    let s = 0
    const base = b * block10ms
    for (let i = 0; i < block10ms; i += 2) {
      const v = mono[base + i]
      s += v * v
    }
    const rms = Math.sqrt(s / (block10ms / 2))
    if (rms > 0.002) {
      audioStartSec = (b * block10ms) / sr
      break
    }
  }

  // 2. Onset detection over the intro (shared log-band front-end).
  const env = onsetEnvelope(mono, sr)
  if (!env) return positiveMod(establishedPhaseSec, beatSec)
  const frames = env.frames
  if (frames < 32) return positiveMod(establishedPhaseSec, beatSec)
  const envRate = env.envRate
  const kickFlux = env.lowOdf
  const totalFlux = env.odf


  // 3. Grid candidate beats: t_k = phase0 + k * beatSec
  const phase0 = positiveMod(establishedPhaseSec, beatSec)
  const maxBeats = Math.floor(scanSeconds / beatSec)

  const kickPeaks: number[] = []
  const totalPeaks: number[] = []
  const windowFrames = Math.max(1, Math.round(envRate * 0.035)) // ±35ms window

  let maxKickFlux = 0
  let maxTotalFlux = 0

  for (let k = 0; k < maxBeats; k++) {
    const t = phase0 + k * beatSec
    const centerFrame = Math.round(t * envRate)
    let kPeak = 0
    let tPeak = 0
    for (let w = -windowFrames; w <= windowFrames; w++) {
      const idx = centerFrame + w
      if (idx >= 0 && idx < frames) {
        if (kickFlux[idx] > kPeak) kPeak = kickFlux[idx]
        if (totalFlux[idx] > tPeak) tPeak = totalFlux[idx]
      }
    }
    kickPeaks.push(kPeak)
    totalPeaks.push(tPeak)
    if (kPeak > maxKickFlux) maxKickFlux = kPeak
    if (tPeak > maxTotalFlux) maxTotalFlux = tPeak
  }

  // Find the earliest grid beat at or after audio starts
  let firstAudibleBeatIdx = 0
  for (let k = 0; k < maxBeats; k++) {
    const t = phase0 + k * beatSec
    if (t >= audioStartSec - 0.05) {
      firstAudibleBeatIdx = k
      break
    }
  }

  // 4. Determine if the intro begins immediately with drums (e.g. J9_lime at 0:00)
  // If the first audible beat already has a drum transient, anchor directly to it!
  const kickThresh = maxKickFlux > 0 ? maxKickFlux * 0.15 : 0
  const totalThresh = maxTotalFlux > 0 ? maxTotalFlux * 0.15 : 0

  const hasDrumAtFirstBeat =
    (kickPeaks[firstAudibleBeatIdx] >= kickThresh && kickThresh > 0) ||
    (totalPeaks[firstAudibleBeatIdx] >= totalThresh && totalThresh > 0)

  if (hasDrumAtFirstBeat) {
    return Math.max(0, phase0 + firstAudibleBeatIdx * beatSec)
  }

  // 5. If the intro starts with ambient/synth pad/silence before a drop (e.g. Lip_rona):
  // Scan forward beat by beat to find the FIRST beat where the kick drum / rhythm drops.
  // The first beat that hits the kick transient threshold is the authentic drop downbeat!
  for (let k = firstAudibleBeatIdx; k < maxBeats; k++) {
    const isKickDrop = kickPeaks[k] >= kickThresh && kickThresh > 0
    const isRhythmDrop = totalPeaks[k] >= totalThresh && totalThresh > 0
    if (isKickDrop || isRhythmDrop) {
      return Math.max(0, phase0 + k * beatSec)
    }
  }

  // Fallback: first audible beat
  return Math.max(0, phase0 + firstAudibleBeatIdx * beatSec)
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
export function detectMixxxRawBpmFromPcm(
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

  const env = onsetEnvelope(mono, sr)
  if (!env) return null
  const frames = env.frames
  if (frames < 256) return null
  const envRate = env.envRate
  const totalFlux = env.odf


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

  // Report the measurement itself. DJ octave normalisation is applied by
  // detectMixxxBpmFromPcm below, where the multiplier can be recorded instead of
  // silently overwriting the detected tempo.
  return Math.round(((60 * envRate) / continuousLag) * 100) / 100
}

/**
 * Mixxx-style BPM for DJ use: the raw measurement with the usual octave
 * interpretation applied. Use {@link detectMixxxRawBpmFromPcm} when both the
 * measurement and the interpretation need to be kept.
 */
export function detectMixxxBpmFromPcm(
  monoAudio: Float32Array,
  sampleRate: number,
  hintBpm?: number
): number | null {
  const raw = detectMixxxRawBpmFromPcm(monoAudio, sampleRate, hintBpm)
  if (raw === null) return null
  return normalizeDjBpm(raw, { minBpm: MIN_BPM, maxBpm: MAX_BPM }).bpm
}
