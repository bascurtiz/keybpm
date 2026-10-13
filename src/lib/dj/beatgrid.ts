import { makeFft, positiveMod } from './dsp'
import type { BeatGrid } from './types'

/**
 * Beat-grid analyzer.
 *
 * Pipeline (pure JS over decoded PCM):
 *  1. Take the loudest ~90s of the track, downmix to mono, decimate 2x.
 *  2. STFT spectral flux: Hann-windowed FFT frames, half-wave-rectified
 *     log-magnitude differences summed over the spectrum.
 *  3. Adaptive post-processing: local-mean removal + normalization.
 *  4. Harmonic-scored autocorrelation proposes tempo candidates.
 *  5. Verified by dynamic-programming beat tracking (Ellis-style).
 *  6. Least-squares regression with outlier rejection into a constant grid.
 *  7. Downbeat detection against low-band flux (bars start where the bass lands).
 */
export async function analyzeBeatGrid(buffer: AudioBuffer): Promise<BeatGrid | null> {
  try {
    await new Promise(r => setTimeout(r, 0))
    return analyze(buffer)
  } catch {
    return null
  }
}

const WIN = 1024
const HOP = 256
const MIN_BPM = 55
const MAX_BPM = 200
const BEATS_PER_BAR = 4
const ANALYSIS_SECONDS = 90

function analyze(buffer: AudioBuffer): BeatGrid | null {
  if (buffer.duration < 8) return null

  // 1. loudest window, mono, decimated
  const decim = buffer.sampleRate >= 32000 ? 2 : 1
  const srA = buffer.sampleRate / decim
  const winSamples = Math.min(buffer.length, Math.floor(buffer.sampleRate * ANALYSIS_SECONDS))
  const start = loudestWindowStart(buffer, winSamples)
  const monoLen = Math.floor(winSamples / decim)
  const mono = new Float32Array(monoLen)
  {
    const tmp = new Float32Array(winSamples)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      buffer.copyFromChannel(tmp, ch, start)
      if (decim === 2) {
        for (let i = 0; i < monoLen; i++) {
          mono[i] += (tmp[2 * i] + tmp[2 * i + 1]) / (2 * buffer.numberOfChannels)
        }
      } else {
        for (let i = 0; i < monoLen; i++) mono[i] += tmp[i] / buffer.numberOfChannels
      }
    }
  }

  // 2. STFT spectral flux over log-spaced bands
  const frames = Math.floor((monoLen - WIN) / HOP)
  if (frames < 512) return null
  const envRate = srA / HOP
  const flux = new Float32Array(frames)
  const lowFlux = new Float32Array(frames)
  const lowEnergy = new Float32Array(frames)
  {
    const fft = makeFft(WIN)
    const hann = new Float32Array(WIN)
    for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN)
    const re = new Float32Array(WIN)
    const im = new Float32Array(WIN)
    const bins = WIN / 2
    const binHz = srA / WIN
    const BANDS = 24
    const bandOfBin = new Int8Array(bins).fill(-1)
    const fMin = 40
    const fMax = srA / 2
    for (let k = 1; k < bins; k++) {
      const freq = k * binHz
      if (freq < fMin) {
        bandOfBin[k] = 0
        continue
      }
      const b = Math.floor((Math.log(freq / fMin) / Math.log(fMax / fMin)) * BANDS)
      bandOfBin[k] = Math.min(b, BANDS - 1)
    }
    const lowBandMax = Math.floor((Math.log(200 / fMin) / Math.log(fMax / fMin)) * BANDS)
    const bandMag = new Float32Array(BANDS)
    const prevLog = new Float32Array(BANDS)
    for (let f = 0; f < frames; f++) {
      const base = f * HOP
      for (let i = 0; i < WIN; i++) re[i] = mono[base + i] * hann[i]
      im.fill(0)
      fft(re, im)
      bandMag.fill(0)
      for (let k = 1; k < bins; k++) {
        bandMag[bandOfBin[k]] += Math.sqrt(re[k] * re[k] + im[k] * im[k])
      }
      let s = 0
      let sLow = 0
      let eLow = 0
      for (let b = 0; b < BANDS; b++) {
        const L = Math.log1p(bandMag[b])
        const d = L - prevLog[b]
        if (d > 0) {
          s += d
          if (b <= lowBandMax) sLow += d
        }
        if (b <= lowBandMax) eLow += bandMag[b]
        prevLog[b] = L
      }
      flux[f] = s
      lowFlux[f] = sLow
      lowEnergy[f] = eLow
    }
  }

  // 3. adaptive post-processing
  subtractLocalMean(flux, 16)
  subtractLocalMean(lowFlux, 16)
  normalizeStd(flux)
  normalizeStd(lowFlux)
  const combined = new Float32Array(frames)
  for (let i = 0; i < frames; i++) combined[i] = flux[i] + 1.5 * lowFlux[i]
  normalizeStd(combined)
  const env = gaussianSmooth(combined, 2)
  const lowEnv = gaussianSmooth(lowFlux, 2)
  zScore(lowEnergy)
  const lowEnergyEnv = gaussianSmooth(lowEnergy, 2)

  // 4. tempo candidates
  const minLag = Math.floor((envRate * 60) / MAX_BPM)
  const maxLag = Math.ceil((envRate * 60) / MIN_BPM)
  const acf = new Float32Array(maxLag * 3 + 2)
  for (let lag = minLag; lag < acf.length; lag++) {
    const n = frames - lag
    if (n < 64) break
    let s = 0
    for (let i = 0; i < n; i++) s += env[i] * env[i + lag]
    acf[lag] = s / n
  }
  const acfAt = (lag: number) => {
    const i = Math.round(lag)
    return i >= 0 && i < acf.length ? acf[i] : 0
  }
  const prior = (bpm: number) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 128) / 0.7, 2))
  const scoreAt = (lag: number) =>
    (acfAt(lag) + acfAt(lag * 2) / 2 + acfAt(lag * 3) / 3) *
    (0.6 + 0.4 * prior((60 * envRate) / lag))

  const peaks: { lag: number; score: number }[] = []
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const s = scoreAt(lag)
    if (s > scoreAt(lag - 1) && s >= scoreAt(lag + 1)) peaks.push({ lag, score: s })
  }
  peaks.sort((a, b) => b.score - a.score)

  const candidates: number[] = []
  const addCandidate = (bpm: number) => {
    if (bpm < MIN_BPM || bpm > MAX_BPM) return
    if (candidates.some(c => Math.abs(c - bpm) / bpm < 0.04)) return
    candidates.push(bpm)
  }
  for (const p of peaks.slice(0, 5)) addCandidate((60 * envRate) / p.lag)
  for (const p of peaks.slice(0, 3)) {
    const bpm = (60 * envRate) / p.lag
    addCandidate(bpm * 2)
    addCandidate(bpm / 2)
    addCandidate(bpm * 1.5)
    addCandidate((bpm * 2) / 3)
  }
  if (candidates.length === 0) return null

  // 5 + 6. verify each candidate by beat tracking + regression
  interface Fit {
    bpm: number
    anchorFrame: number
    beatFrames: number
    score: number
  }
  let best: Fit | null = null
  for (const bpm0 of candidates) {
    const tau = (envRate * 60) / bpm0
    const beats = trackBeats(env, tau)
    if (beats.length < 16) continue
    const fit = fitLine(beats)
    if (!fit) continue
    const bpm = (60 * envRate) / fit.slope
    if (bpm < 50 || bpm > 210) continue
    let s = 0
    let k = 0
    for (let p = fit.intercept; p < frames - 1 && p >= 0; p += fit.slope, k++) {
      s += interp(env, p)
    }
    if (k < 16) continue
    const contrast = (s / k) * fit.keptRatio * (0.6 + 0.4 * prior(bpm))
    if (!best || contrast > best.score) {
      best = { bpm, anchorFrame: fit.intercept, beatFrames: fit.slope, score: contrast }
    }
  }
  if (!best || best.score <= 0) return null

  // 7. downbeat among the four rotations
  let bestBarOffset = 0
  let bestBarScore = -Infinity
  for (let c = 0; c < BEATS_PER_BAR; c++) {
    let s = 0
    let k = 0
    for (
      let p = best.anchorFrame + c * best.beatFrames;
      p < frames - 5 && p >= 0;
      p += best.beatFrames * BEATS_PER_BAR, k++
    ) {
      s += interp(lowEnergyEnv, p + 4) + 0.5 * interp(lowEnv, p) + 0.25 * interp(env, p)
    }
    const score = k > 0 ? s / k : -Infinity
    if (score > bestBarScore) {
      bestBarScore = score
      bestBarOffset = c
    }
  }

  const ONSET_LEAD = 0.01
  const toSeconds = (frame: number) =>
    start / buffer.sampleRate + (frame * HOP + WIN / 2) / srA + ONSET_LEAD
  const beatLen = 60 / best.bpm
  const barLen = beatLen * BEATS_PER_BAR
  const firstBeatRaw = toSeconds(best.anchorFrame)
  const firstBarRaw = toSeconds(best.anchorFrame + bestBarOffset * best.beatFrames)

  return {
    bpm: Math.round(best.bpm * 100) / 100,
    firstBeat: positiveMod(firstBeatRaw, beatLen),
    firstBar: positiveMod(firstBarRaw, barLen),
    beatsPerBar: BEATS_PER_BAR,
  }
}

function trackBeats(env: Float32Array, tau: number): number[] {
  const n = env.length
  const C = new Float32Array(n)
  const P = new Int32Array(n).fill(-1)
  const lo = Math.max(1, Math.round(tau / 2))
  const hi = Math.round(tau * 2)
  const tightness = 100
  for (let t = 0; t < n; t++) {
    let bestV = 0
    let bestI = -1
    const from = Math.max(0, t - hi)
    const to = t - lo
    for (let t2 = from; t2 <= to; t2++) {
      const logr = Math.log((t - t2) / tau)
      const v = C[t2] - tightness * logr * logr
      if (v > bestV) {
        bestV = v
        bestI = t2
      }
    }
    C[t] = env[t] + (bestI >= 0 ? bestV : 0)
    P[t] = bestI
  }
  let t = n - 1
  let bestC = -Infinity
  for (let i = Math.max(0, n - Math.round(tau * 1.5)); i < n; i++) {
    if (C[i] > bestC) {
      bestC = C[i]
      t = i
    }
  }
  const beats: number[] = []
  while (t >= 0) {
    beats.push(t)
    t = P[t]
  }
  beats.reverse()
  return beats
}

function fitLine(
  beats: number[]
): { slope: number; intercept: number; keptRatio: number } | null {
  const points = beats.map((t, i) => ({ x: i, y: t }))
  const solve = (pts: { x: number; y: number }[]) => {
    const n = pts.length
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    for (const p of pts) {
      sx += p.x
      sy += p.y
      sxx += p.x * p.x
      sxy += p.x * p.y
    }
    const denom = n * sxx - sx * sx
    if (denom === 0) return null
    const slope = (n * sxy - sx * sy) / denom
    const intercept = (sy - slope * sx) / n
    return { slope, intercept }
  }
  const fit = solve(points)
  if (!fit || fit.slope <= 0) return null
  const residuals = points.map(p => p.y - (fit!.intercept + fit!.slope * p.x))
  const sigma = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / residuals.length)
  if (sigma > 0) {
    const kept = points.filter((_, i) => Math.abs(residuals[i]) <= 2.5 * sigma)
    if (kept.length >= 8 && kept.length < points.length) {
      const refit = solve(kept)
      if (refit && refit.slope > 0) {
        const keptRatio = kept.length / points.length
        return { ...refit, keptRatio }
      }
    }
  }
  return { ...fit, keptRatio: 1 }
}

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

function subtractLocalMean(x: Float32Array, half: number) {
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

function normalizeStd(x: Float32Array) {
  let sum = 0
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i]
  const std = Math.sqrt(sum / x.length)
  if (std > 0) for (let i = 0; i < x.length; i++) x[i] /= std
}

function zScore(x: Float32Array) {
  let mean = 0
  for (let i = 0; i < x.length; i++) mean += x[i]
  mean /= x.length
  let varSum = 0
  for (let i = 0; i < x.length; i++) {
    x[i] -= mean
    varSum += x[i] * x[i]
  }
  const std = Math.sqrt(varSum / x.length)
  if (std > 0) for (let i = 0; i < x.length; i++) x[i] /= std
}

function gaussianSmooth(x: Float32Array, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3)
  const kernel = new Float32Array(radius * 2 + 1)
  let ksum = 0
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-0.5 * (i / sigma) * (i / sigma))
    ksum += kernel[i + radius]
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) {
    let s = 0
    for (let j = -radius; j <= radius; j++) {
      const idx = i + j
      if (idx >= 0 && idx < x.length) s += x[idx] * kernel[j + radius]
    }
    out[i] = s
  }
  return out
}

function interp(x: Float32Array, pos: number): number {
  const i = Math.floor(pos)
  if (i < 0 || i >= x.length - 1) return 0
  const frac = pos - i
  return x[i] + (x[i + 1] - x[i]) * frac
}
