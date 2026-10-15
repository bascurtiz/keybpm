import { positiveMod } from './dsp.ts'
import type { BeatGrid, BeatGridAnalysis } from './types.ts'
import {
  ODF_HOP,
  ODF_WIN,
  computeOnsetEnvelope,
  frameToSeconds,
  suppressBackground,
} from './spectral-flux.ts'
import type { OnsetEnvelope } from './spectral-flux.ts'
import { normalizeDjBpm, trackBeats } from './beat-tracker.ts'
import { analysisDecimation, readChannelInto, type PcmSource } from './pcm.ts'
import {
  estimateTempoCandidates,
  resolveTempo,
  type TempoCandidate,
  type TempoResolution,
} from './tempo-candidates.ts'

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
import { getOrInitEssentia } from './essentia-loader.ts'
import { beatGridFromMap, buildBeatMapFromTicks } from './grid.ts'

export async function analyzeBeatGrid(
  buffer: PcmSource,
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
 * The measurement path on its own: log-band flux -> autocorrelation -> lattice
 * phase -> Ellis DP -> optional beat map. No Essentia, no `AudioBuffer`.
 *
 * This is the analyzer the benchmark scores. It is also a genuine fallback in
 * production (it is what runs when the Essentia kernel cannot load), so scoring
 * it headlessly measures shipping code, not a test double.
 */
export function analyzeBeatGridFromPcm(source: PcmSource, hintBpm?: number): BeatGrid | null {
  return analyze(source, hintBpm)
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
 * How strongly non-low (snare, clap, hat) content counts toward the phase
 * decision, relative to the kick group. Chosen so a hat or snare on the beat
 * settles a tie against an offbeat bassline without letting a cymbal pattern
 * overrule a kick that is actually there.
 */
const PERCUSSIVE_PHASE_WEIGHT = 0.5

/**
 * Beat-position evidence: the kick group plus the percussive group (everything
 * above the low group), each normalised to its own peak.
 *
 * The phase anchor used to score the kick group alone, and the benchmark found
 * what that costs: on a techno track with a sub-bass on the offbeat, the grid
 * locked to the *bass* instead of the kick — a half-beat-out grid, the one error
 * a DJ hears immediately. A sustained sub and a kick are both "low energy", and
 * a sharp bass attack is a low onset like any other.
 *
 * Normalising each group to its own peak is what makes the two comparable: in
 * log-magnitude flux a quiet hi-hat can change a band as much as a kick changes
 * its band, so the groups are compared by *shape*, not by absolute level. A track
 * with no low content leaves the low scale at zero and this degrades to the
 * percussive evidence alone, which is the old fallback behaviour.
 */
function phaseEvidence(env: OnsetEnvelope): Float32Array {
  const out = new Float32Array(env.frames)
  let lowPeak = 0
  let percussivePeak = 0
  for (let i = 0; i < env.frames; i++) {
    const percussive = Math.max(0, env.odf[i] - env.lowOdf[i])
    if (env.lowOdf[i] > lowPeak) lowPeak = env.lowOdf[i]
    if (percussive > percussivePeak) percussivePeak = percussive
  }
  const lowScale = lowPeak > 0 ? 1 / lowPeak : 0
  const percussiveScale = percussivePeak > 0 ? PERCUSSIVE_PHASE_WEIGHT / percussivePeak : 0
  for (let i = 0; i < env.frames; i++) {
    out[i] =
      env.lowOdf[i] * lowScale +
      Math.max(0, env.odf[i] - env.lowOdf[i]) * percussiveScale
  }
  return out
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
 * Queen Mary Tempo and Beat Tracker (Degara) with "Assume constant tempo"
 * as recommended in Mixxx.
 */
async function analyzeQueenMaryBeatGrid(
  buffer: PcmSource,
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
  if ((!rawBpm || rawBpm <= 0) && (!mixxxRaw || mixxxRaw <= 0)) return null

  // The tempo decision is made on an envelope, so the envelope comes first — and
  // it is built exactly the way the measurement path builds it: the clearest
  // rhythmic window of the track, not the intro. That matters twice over. The
  // loudest window is where the material actually states its beat, and measuring
  // both paths on the same signal is what lets a disagreement between them mean
  // something. It also fixed the last defect this harness found here: on a
  // half-time track at 140 BPM the intro's hats put the anchor half a beat off
  // the beat (**213 ms** of phase error), while the loudest window put it on it.
  const decim = analysisDecimation(buffer.sampleRate)
  const sr = buffer.sampleRate / decim
  const winSamples = Math.min(buffer.length, Math.floor(buffer.sampleRate * ANALYSIS_SECONDS))
  const startSample = loudestWindowStart(buffer, winSamples)
  const winMonoLen = Math.floor(winSamples / decim)
  const winMono = new Float32Array(winMonoLen)
  {
    const tmp = new Float32Array(winSamples)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      readChannelInto(buffer, tmp, ch, startSample, winSamples)
      if (decim === 2) {
        for (let i = 0; i < winMonoLen; i++) {
          winMono[i] += (tmp[2 * i] + tmp[2 * i + 1]) / (2 * buffer.numberOfChannels)
        }
      } else {
        for (let i = 0; i < winMonoLen; i++) {
          winMono[i] += tmp[i] / buffer.numberOfChannels
        }
      }
    }
  }
  const env = onsetEnvelope(winMono, sr)
  if (!env || env.frames < 256) return null
  const windowStartSec = startSample / buffer.sampleRate

  // Tempo by committee, with Essentia's own reading as an octave-committed voter
  // — see ./tempo-candidates for why a threshold is not good enough. This path
  // used to decide the octave with an ad-hoc pairwise cross-check against the
  // kick autocorrelation and take its phase from Essentia's tick list, and the
  // benchmark showed the cost: a 174 BPM drum-and-bass track stored as 87 BPM,
  // plus three tracks whose tick list accents half a beat away from the beat
  // (211-240 ms of phase error at 122-140 BPM). Both decisions are made from the
  // same measured evidence the measurement path uses, and both are stored on the
  // track as provenance.
  const regionFit = rawTicks.length >= 2 ? makeConstBpm(retrieveConstRegions(rawTicks)) : null
  const regionBpm = regionFit && regionFit.roundBpm > 0 ? regionFit.roundBpm : null
  const fusion = resolveTempo(
    [
      ...estimateTempoCandidates(env, { minBpm: MIN_BPM, maxBpm: MAX_BPM }),
      // Essentia's reading votes with high confidence but *not* as a committed
      // octave. It was marked committed until the benchmark scored both paths: on
      // a 174 BPM 2-step break, degara's tactus is the half-time pulse (87.09 BPM),
      // and a committed vote at 87 **froze the octave decision before the tempo
      // prior could tie-break** — the same prior tie-break the measurement path
      // uses to reach 174 on that track. Marking it committed added nothing on the
      // other eight tracks (where it agrees with the non-committed estimators
      // anyway) and cost the one track where agreement is not the answer, so the
      // engine's octave opinion is now evidence of the period, weighed at 0.9,
      // rather than a veto on the beat rate.
      ...(rawBpm > 0
        ? [{ bpm: rawBpm, source: 'essentia' as const, confidence: 0.9, octaveCommitted: false }]
        : []),
      ...(mixxxRaw !== null && mixxxRaw > 0
        ? [
            {
              bpm: mixxxRaw,
              source: 'mixxx-acf' as const,
              confidence: 0.7,
              octaveCommitted: false,
            },
          ]
        : []),
      ...(regionBpm !== null
        ? [
            {
              bpm: regionBpm,
              source: 'mixxx-regions' as const,
              confidence: 0.4,
              octaveCommitted: false,
            },
          ]
        : []),
    ],
    env,
    { minBpm: MIN_BPM, maxBpm: MAX_BPM }
  )
  if (!fusion) return null

  // A reading the analyzer's own tempo range cannot express is not a tempo, and
  // the committee has nothing useful to say about one. Essentia's
  // RhythmExtractor does produce one on degenerate input — a silent buffer (the
  // browser smoke test above passed a buffer it had filled the wrong way round)
  // came back as **738.28 BPM**, and with nothing for the cross-check to compare
  // against that number was stored as the track's BPM while the measurement path
  // correctly declined to produce a grid at all.
  if (!(fusion.bpm >= MIN_BPM * 0.9) || fusion.bpm > MAX_BPM * 1.1) return null

  // Phase and tempo refinement on the evidence envelope: the kick group plus the
  // percussive group, each normalised to its own peak. The Essentia tick list is
  // no longer trusted for phase — it survives below as extra ticks for a
  // variable-tempo map, where the map has to agree with the agreed tempo to be
  // kept at all.
  const evidence = phaseEvidence(env)
  const refined = refineTempoAndPhase(evidence, env.envRate, fusion.bpm)
  const bpm = refined.score > 0 ? Math.round(refined.bpm * 100) / 100 : fusion.bpm
  const beatSec = 60 / bpm
  const phaseFrame =
    refined.phaseFrame >= 0
      ? refined.phaseFrame
      : bestLatticePhase(evidence, env.envRate, beatSec)
  const phaseSec =
    phaseFrame >= 0 ? frameToSeconds(phaseFrame, sr, ODF_HOP, ODF_WIN, windowStartSec) : 0

  // Ellis-style dynamic-programming beat tracking over the same envelope. This
  // is what lets the grid follow a performance that wobbles — a real drummer, a
  // vinyl rip, a tape-saturated edit — instead of asserting one rigid phase, and
  // its residual is the analyzer's own evidence for how well it did.
  const tracked = trackBeats(env.odf, env.envRate, { bpm, minBpm: MIN_BPM, maxBpm: MAX_BPM })
  const trackedBeats = tracked
    ? tracked.keptFrames.map(f => frameToSeconds(f, sr, ODF_HOP, ODF_WIN, windowStartSec))
    : null

  // Locate the actual first beat / downbeat from the audio intro (Bar 1 downbeat anchor)
  const firstBarTime = findMixxxFirstBeatAtIntro(buffer, bpm, phaseSec, rawTicks)
  const constantGrid: BeatGrid = {
    bpm,
    firstBar: firstBarTime,
    firstBeat: positiveMod(firstBarTime, beatSec),
    beatsPerBar: BEATS_PER_BAR,
  }

  // Provenance: what was measured, what interpretation was applied, which engines
  // voted and how well the tracked beats fitted. The candidates and the decision
  // reason are the committee's own — a disagreement between engines is visible on
  // the track itself rather than only deciding the outcome.
  const analysis: BeatGridAnalysis = {
    rawBpm: fusion.measuredBpm,
    bpmMultiplier: fusion.multiplier,
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
    tempoCandidates: fusion.candidates.map(toStoredCandidate),
    octaveDecision: fusion.reason,
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

  if (outcome.map && !mapAgreesWithTempo(outcome.map, bpm)) {
    // A beat map built from a tick list that disagrees with the tempo the
    // analyzer decided on is not a grid: it claims a different tempo as well as
    // different beat times. Essentia's tick lists do this on degenerate input —
    // they produced a map at 738.57 BPM, which the cross-checked constant grid
    // did not have. Keep the constant grid in that case; a wrong map is worse
    // than a rigid lattice.
    console.warn(
      `beat map rejected: local tempo ${outcome.map.bpm} disagrees with ${bpm}`
    )
    return withAnalysis
  }

  if (!outcome.map) {
    // No map, but the beats may still pin down a better single tempo than the
    // rounded one. Adopt it so a small tempo error is not left to accumulate —
    // but only when it agrees with the tempo the analyzer decided on, for the
    // same reason the map guard exists: a tick list that claims 738 BPM is a
    // broken tick list, not a refinement of a 128 BPM reading. Without this,
    // Essentia's ticks silently replaced a cross-checked tempo.
    if (
      !(outcome.refinedBpm > 0) ||
      !mapAgreesWithTempo({ bpm: outcome.refinedBpm }, bpm) ||
      Math.abs(outcome.refinedBpm - bpm) < 0.01
    ) {
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

/**
 * Does a beat map's tempo agree with the tempo the analyzer decided on?
 *
 * A map is a claim about *when* the beats are, and it is only useful if it also
 * agrees about how fast they are. A ±15 % window is far wider than any real
 * variable-tempo track (124 → 128 BPM is 3 %) and far narrower than an octave
 * error, so it rejects the latter without touching the former.
 */
function mapAgreesWithTempo(map: { bpm: number }, bpm: number, tolerance = 0.15): boolean {
  if (!(map.bpm > 0) || !(bpm > 0)) return false
  return Math.abs(map.bpm - bpm) / bpm <= tolerance
}

/**
 * Refine a tempo by scanning a narrow band of candidates against the envelope,
 * re-optimising the lattice phase at each step.
 *
 * The measurement chain (autocorrelation peak, then the DP line fit, then the map
 * builder's refined tempo) resolves tempo to about 0.1 %, and the benchmark showed
 * what that costs: a 0.16 % error is 40 ms of drift over a 40 s window, because a
 * constant grid multiplies the error by the track length. On a six-minute track it
 * is four seconds — a grid that starts aligned and ends a beat out.
 *
 * The scan is deliberately local (±1.2 % in 0.04 % steps): it is a refinement of
 * a tempo that is already right, not a second search, so it cannot jump octaves or
 * land on a syncopated subdivision. Scoring is mean evidence per lattice point,
 * discounted by how much of the track the lattice spans, so a fast candidate with
 * few hits cannot win on a lucky phase.
 */
function refineTempoAndPhase(
  evidence: Float32Array,
  envRate: number,
  bpm: number,
  searchFraction = 0.012,
  stepFraction = 0.0004
): { bpm: number; phaseFrame: number; score: number } {
  let best = { bpm, phaseFrame: -1, score: -1 }
  const steps = Math.max(4, Math.round(searchFraction / stepFraction))
  for (let step = -steps; step <= steps; step++) {
    const candidate = bpm * (1 + step * stepFraction)
    if (!(candidate > 0)) continue
    const beatFrames = (envRate * 60) / candidate
    const phases = Math.max(1, Math.round(beatFrames))
    for (let phase = 0; phase < phases; phase++) {
      let sum = 0
      let hits = 0
      for (let at = phase; at < evidence.length; at += beatFrames) {
        const index = Math.round(at)
        if (index >= evidence.length) break
        sum += evidence[index]
        hits++
      }
      if (hits < 8) continue
      const score = (sum / hits) * Math.min(1, hits / 64)
      if (score > best.score) best = { bpm: candidate, phaseFrame: phase, score }
    }
  }
  return best
}

/**
 * Decide the octave of a measured tempo from estimator agreement, not a threshold.
 *
 * The fused hypothesis decides *which* octave; the multiplier is then applied to
 * the measured tempo, so the parabolic interpolation's decimals survive the
 * decision (127.83 stays 127.83 instead of being replaced by a cluster mean).
 */
function resolveTempoAgainstEnvelope(env: OnsetEnvelope, measuredBpm: number): TempoResolution {
  const options = { minBpm: MIN_BPM, maxBpm: MAX_BPM }
  const candidates = estimateTempoCandidates(env, options)
  const measured: TempoCandidate = {
    bpm: measuredBpm,
    source: 'onset-acf',
    confidence: 0.85,
    octaveCommitted: false,
  }
  const resolution = resolveTempo([...candidates, measured], env, options)
  if (!resolution || !(measuredBpm > 0)) {
    const normalised = normalizeDjBpm(measuredBpm, options)
    return {
      bpm: normalised.bpm,
      measuredBpm,
      multiplier: normalised.multiplier,
      candidates,
      reason: 'no tempo candidates: threshold rule applied',
    }
  }
  const ratio = resolution.bpm / measuredBpm
  const multiplier = Math.abs(ratio - 2) <= 0.1 ? 2 : Math.abs(ratio - 0.5) <= 0.1 ? 0.5 : 1
  return { ...resolution, bpm: Math.round(measuredBpm * multiplier * 100) / 100, multiplier }
}

/** Provenance record for one tempo hypothesis, as stored on the track. */
function toStoredCandidate(candidate: TempoCandidate): { bpm: number; source: string; confidence: number } {
  return {
    bpm: Math.round(candidate.bpm * 100) / 100,
    source: candidate.source,
    confidence: Math.round(candidate.confidence * 1000) / 1000,
  }
}

function analyze(buffer: PcmSource, hintBpm?: number): BeatGrid | null {
  if (buffer.duration < 4) return null

  // 1. Take up to 90 seconds from the clearest/loudest rhythmic section of the track
  const decim = analysisDecimation(buffer.sampleRate)
  const sr = buffer.sampleRate / decim
  const winSamples = Math.min(buffer.length, Math.floor(buffer.sampleRate * ANALYSIS_SECONDS))
  const startSample = loudestWindowStart(buffer, winSamples)
  const monoLen = Math.floor(winSamples / decim)
  const mono = new Float32Array(monoLen)

  {
    const tmp = new Float32Array(winSamples)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      readChannelInto(buffer, tmp, ch, startSample, winSamples)
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

  // Octave decision by committee. The autocorrelation above is precise about the
  // period and blind to the octave, so several estimators vote (see
  // ./tempo-candidates) and the applied multiplier is kept alongside the raw
  // measurement so the interpretation stays visible and reversible.
  const fusion = resolveTempoAgainstEnvelope(env, measuredBpm)
  const finalBpm = fusion.bpm

  // 6. Grid phase alignment and tempo refinement, on one shared evidence
  //    envelope: the kick group plus the percussive group, each normalised to its
  //    own peak, instead of a weighted blend of three hand-picked bands.
  const evidence = phaseEvidence(env)
  const refined = refineTempoAndPhase(evidence, envRate, finalBpm)
  const storedBpm = refined.score > 0 ? Math.round(refined.bpm * 100) / 100 : finalBpm
  const storedBeatSec = 60 / storedBpm
  const phaseFrame =
    refined.phaseFrame >= 0 ? refined.phaseFrame : bestLatticePhase(evidence, envRate, storedBeatSec)
  const bestPhaseFrame = phaseFrame >= 0 ? phaseFrame : 0

  // Convert best phase frame relative to buffer start
  const windowStartSec = startSample / buffer.sampleRate
  const phaseSec = frameToSeconds(bestPhaseFrame, sr, ODF_HOP, ODF_WIN, windowStartSec)

  // 7. Mixxx First Beat / Bar 1 Anchor:
  // Locate the actual first kick downbeat from the audio intro (first 30 seconds)
  const firstBarTime = findMixxxFirstBeatAtIntro(buffer, storedBpm, phaseSec)

  // 8. Beat tracking and the variable-tempo decision.
  //
  //    The measurement path used to stop at a rigid lattice, which is why a
  //    wobbling or accelerating track kept a constant grid here while the Essentia
  //    path produced a beat map — the fallback was measurably worse than the
  //    primary, and only on the material that needs the map most. Both paths now
  //    track beats and offer the ticks to the same map builder.
  const tracked = trackBeats(env.odf, envRate, { bpm: storedBpm, minBpm: MIN_BPM, maxBpm: MAX_BPM })
  const trackedBeats = tracked
    ? tracked.keptFrames.map(frame => frameToSeconds(frame, sr, ODF_HOP, ODF_WIN, windowStartSec))
    : null

  const analysis: BeatGridAnalysis = {
    rawBpm: fusion.measuredBpm,
    bpmMultiplier: fusion.multiplier,
    bpmSource: 'onset-acf',
    beatSource: tracked ? 'ellis-dp' : 'constant-lattice',
    fitResidual: tracked?.residualLogRms,
    contrast: tracked?.contrast,
    retainedRatio: tracked?.retainedRatio,
    confidence: tracked?.confidence,
    tempoCandidates: fusion.candidates.map(toStoredCandidate),
    octaveDecision: fusion.reason,
  }

  const constantGrid: BeatGrid = {
    bpm: storedBpm,
    firstBeat: positiveMod(firstBarTime, storedBeatSec),
    firstBar: firstBarTime,
    beatsPerBar: BEATS_PER_BAR,
  }
  const withAnalysis: BeatGrid = { ...constantGrid, analysis }

  const outcome = trackedBeats
    ? buildBeatMapFromTicks(trackedBeats, storedBpm, phaseSec, buffer.duration)
    : null
  if (!outcome) return withAnalysis

  if (!outcome.map) {
    // A constant fit was good enough, but the ticks may still pin down a better
    // single tempo than the rounded one; adopt it so a small tempo error is not
    // left to accumulate. Only when it agrees with the decided tempo, so a
    // bogus tick list cannot overwrite a cross-checked one (see the Essentia
    // path, where exactly that happened).
    if (
      !(outcome.refinedBpm > 0) ||
      !mapAgreesWithTempo({ bpm: outcome.refinedBpm }, storedBpm) ||
      Math.abs(outcome.refinedBpm - storedBpm) < 0.01
    ) {
      return withAnalysis
    }
    const refinedBpm = Math.round(outcome.refinedBpm * 100) / 100
    return {
      ...withAnalysis,
      bpm: refinedBpm,
      firstBeat: positiveMod(firstBarTime, 60 / refinedBpm),
    }
  }

  if (!mapAgreesWithTempo(outcome.map, storedBpm)) {
    // Same guard as the Essentia path: a beat map that also claims a different
    // tempo is not a grid. See `mapAgreesWithTempo`.
    console.warn(`beat map rejected: local tempo ${outcome.map.bpm} disagrees with ${storedBpm}`)
    return withAnalysis
  }
  return { ...beatGridFromMap(constantGrid, outcome.map), analysis: { ...analysis, variable: true } }
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
  buffer: PcmSource,
  bpm: number,
  establishedPhaseSec: number,
  _rawTicks?: number[]
): number {
  const beatSec = 60 / bpm
  const srOrig = buffer.sampleRate
  const scanSeconds = Math.min(buffer.duration, 35)
  if (scanSeconds <= 0) return positiveMod(establishedPhaseSec, beatSec)

  const decim = analysisDecimation(srOrig)
  const sr = srOrig / decim
  const monoLen = Math.floor(scanSeconds * sr)
  if (monoLen < WIN + HOP) return positiveMod(establishedPhaseSec, beatSec)

  // Downmix intro section to mono Float32Array (decimated to ~22.05 kHz)
  const mono = new Float32Array(monoLen)
  {
    const tmp = new Float32Array(monoLen * decim)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      readChannelInto(buffer, tmp, ch, 0, monoLen * decim)
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
function loudestWindowStart(buffer: PcmSource, length: number): number {
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
