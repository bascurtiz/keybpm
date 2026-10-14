import assert from 'node:assert';

function makeFft(n) {
  const levels = Math.round(Math.log2(n));
  const cosT = new Float32Array(n / 2);
  const sinT = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / n);
    sinT[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r = (r << 1) | ((i >>> b) & 1);
    rev[i] = r;
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = cosT[k];
          const s = sinT[k];
          const tre = re[j + half] * c + im[j + half] * s;
          const tim = im[j + half] * c - re[j + half] * s;
          re[j + half] = re[j] - tre;
          im[j + half] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  };
}

function positiveMod(v, m) {
  return ((v % m) + m) % m;
}

function analyzeMixxxBeatGrid(audio, sr, hintBpm) {
  const WIN = 1024;
  const HOP = 128; // high resolution (~5.8ms at 22050Hz)
  const envRate = sr / HOP;
  const frames = Math.floor((audio.length - WIN) / HOP);
  if (frames < 256) return null;

  const fft = makeFft(WIN);
  const hann = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN);
  const re = new Float32Array(WIN);
  const im = new Float32Array(WIN);

  const binHz = sr / WIN;
  // Sub-bands matching Queen Mary / Mixxx AnalyzerQueenMaryBeats:
  // Low (Kick): 35 - 180 Hz
  // Mid (Snare/synth): 180 - 1500 Hz
  // High (Hi-hats): 1500 - 8000 Hz
  const lowBinStart = Math.max(1, Math.floor(35 / binHz));
  const lowBinEnd = Math.floor(180 / binHz);
  const midBinEnd = Math.floor(1500 / binHz);
  const highBinEnd = Math.min(WIN / 2 - 1, Math.floor(8000 / binHz));

  const kickFlux = new Float32Array(frames);
  const totalFlux = new Float32Array(frames);

  let prevLowMag = 0;
  let prevMidMag = 0;
  let prevHighMag = 0;

  for (let f = 0; f < frames; f++) {
    const base = f * HOP;
    for (let i = 0; i < WIN; i++) re[i] = audio[base + i] * hann[i];
    im.fill(0);
    fft(re, im);

    let lowMag = 0;
    for (let k = lowBinStart; k <= lowBinEnd; k++) {
      lowMag += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    let midMag = 0;
    for (let k = lowBinEnd + 1; k <= midBinEnd; k++) {
      midMag += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    let highMag = 0;
    for (let k = midBinEnd + 1; k <= highBinEnd; k++) {
      highMag += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }

    const lowLog = Math.log1p(lowMag);
    const midLog = Math.log1p(midMag);
    const highLog = Math.log1p(highMag);

    const dLow = Math.max(0, lowLog - prevLowMag);
    const dMid = Math.max(0, midLog - prevMidMag);
    const dHigh = Math.max(0, highLog - prevHighMag);

    prevLowMag = lowLog;
    prevMidMag = midLog;
    prevHighMag = highLog;

    kickFlux[f] = dLow;
    // Mixxx weighting: kick drum transients are the primary beat anchor
    totalFlux[f] = 2.5 * dLow + 1.0 * dMid + 0.6 * dHigh;
  }

  // Adaptive background suppression (local moving mean subtraction, ~120ms window)
  const filterHalf = Math.round(envRate * 0.06);
  subtractMovingMean(kickFlux, filterHalf);
  subtractMovingMean(totalFlux, filterHalf);

  // Autocorrelation over totalFlux
  const MIN_BPM = 65;
  const MAX_BPM = 195;
  const minLag = Math.floor((envRate * 60) / MAX_BPM);
  const maxLag = Math.ceil((envRate * 60) / MIN_BPM);
  const maxAcfLag = maxLag * 3 + 4;
  const acf = new Float32Array(maxAcfLag);

  for (let lag = minLag; lag < maxAcfLag; lag++) {
    const n = frames - lag;
    if (n < 64) break;
    let s = 0;
    for (let i = 0; i < n; i++) s += totalFlux[i] * totalFlux[i + lag];
    acf[lag] = s / n;
  }

  const acfAt = lag => {
    const i = Math.round(lag);
    return i >= 0 && i < acf.length ? acf[i] : 0;
  };

  // Mixxx DJ dance tempo prior centered at 125 BPM
  const prior = bpm => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.40, 2));

  // Comb filter harmonic sum
  const scoreAt = lag => {
    const bpm = (60 * envRate) / lag;
    const base = acfAt(lag);
    const harm2 = acfAt(lag * 2);
    const harm3 = acfAt(lag * 3);
    const harmHalf = acfAt(lag / 2);
    let s = (base + 0.6 * harm2 + 0.3 * harm3 + 0.35 * harmHalf) * (0.35 + 0.65 * prior(bpm));
    if (hintBpm && Math.abs(bpm - hintBpm) / hintBpm < 0.04) {
      s *= 1.35;
    }
    return s;
  };

  // Find candidate peaks
  const peaks = [];
  for (let lag = minLag + 1; lag < maxLag - 1; lag++) {
    const s = scoreAt(lag);
    if (s > scoreAt(lag - 1) && s >= scoreAt(lag + 1)) {
      peaks.push({ lag, score: s });
    }
  }
  peaks.sort((a, b) => b.score - a.score);

  if (peaks.length === 0) return null;

  // Parabolic interpolation around best peak (SoundTouch PeakFinder)
  const topLag = peaks[0].lag;
  const y0 = scoreAt(topLag - 1);
  const y1 = scoreAt(topLag);
  const y2 = scoreAt(topLag + 1);
  const denom = 2 * (y0 - 2 * y1 + y2);
  let delta = 0;
  if (denom < -1e-6) {
    delta = (y0 - y2) / denom;
    delta = Math.max(-0.5, Math.min(0.5, delta));
  }
  let continuousLag = topLag + delta;

  // Check if half-lag (double tempo) is an active fundamental peak
  const halfLag = Math.round(continuousLag / 2);
  if (halfLag >= minLag) {
    const sHalf = scoreAt(halfLag);
    const sFull = scoreAt(Math.round(continuousLag));
    // If half-lag has strong comb score, it is the fundamental rhythm (e.g. 174 BPM instead of 87 BPM)
    if (sHalf >= 0.55 * sFull) {
      continuousLag = continuousLag / 2;
    }
  }

  let detectedBpm = (60 * envRate) / continuousLag;

  // Octave check: favor DJ dance range [100, 165]
  if (detectedBpm < 85 && detectedBpm * 2 <= MAX_BPM) {
    detectedBpm *= 2;
  } else if (detectedBpm > 185 && detectedBpm / 2 >= MIN_BPM) {
    detectedBpm /= 2;
  }

  const finalBpm = Math.round(detectedBpm * 100) / 100;
  const beatSec = 60 / finalBpm;
  const beatFrames = beatSec * envRate;

  // Mixxx BeatGrid Phase Alignment:
  // Correlate candidate grid phases [0, beatFrames) with kick flux peaks
  const numPhaseSteps = Math.round(beatFrames);
  let bestPhaseFrame = 0;
  let maxPhaseScore = -1;

  for (let p = 0; p < numPhaseSteps; p++) {
    let score = 0;
    let count = 0;
    for (let frame = p; frame < frames; frame += beatFrames) {
      const idx = Math.round(frame);
      if (idx < frames) {
        score += 2.5 * kickFlux[idx] + totalFlux[idx];
        count++;
      }
    }
    const avgScore = count > 0 ? score / count : 0;
    if (avgScore > maxPhaseScore) {
      maxPhaseScore = avgScore;
      bestPhaseFrame = p;
    }
  }

  // Convert best phase frame to seconds
  const phaseSec = (bestPhaseFrame * HOP + WIN / 2) / sr;

  // Mixxx First Beat Anchor:
  // 160Hz Butterworth lowpass filter to isolate kick drum fundamental
  const fc = 160;
  const w0 = (2 * Math.PI * fc) / sr;
  const alpha = Math.sin(w0) / (2 * 0.707);
  const cosw0 = Math.cos(w0);
  const b0 = (1 - cosw0) / 2;
  const b1 = 1 - cosw0;
  const b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  const invA0 = 1 / a0;
  const cB0 = b0 * invA0;
  const cB1 = b1 * invA0;
  const cB2 = b2 * invA0;
  const cA1 = a1 * invA0;
  const cA2 = a2 * invA0;

  const scanSamples = Math.min(audio.length, Math.floor(30 * sr));
  const filtered = new Float32Array(scanSamples);
  let fx1 = 0, fx2 = 0, fy1 = 0, fy2 = 0;
  for (let i = 0; i < scanSamples; i++) {
    const x0 = audio[i];
    const y0 = cB0 * x0 + cB1 * fx1 + cB2 * fx2 - cA1 * fy1 - cA2 * fy2;
    fx2 = fx1; fx1 = x0; fy2 = fy1; fy1 = y0;
    filtered[i] = y0;
  }

  const blockSize = Math.floor(sr * 0.02);
  const numBlocks = Math.floor(scanSamples / blockSize);
  const kickEnergy = new Float32Array(numBlocks);
  for (let b = 0; b < numBlocks; b++) {
    let s = 0;
    const base = b * blockSize;
    for (let i = 0; i < blockSize; i += 2) {
      const v = filtered[base + i];
      s += v * v;
    }
    kickEnergy[b] = s;
  }

  const phase0 = positiveMod(phaseSec, beatSec);
  const maxBeats = Math.floor(scanSamples / (sr * beatSec));
  const beatEnergies = [];

  for (let k = 0; k < maxBeats; k++) {
    const t = phase0 + k * beatSec;
    const centerBlock = Math.round((t * sr) / blockSize);
    let e = 0;
    for (let w = -2; w <= 2; w++) {
      const idx = centerBlock + w;
      if (idx >= 0 && idx < numBlocks) {
        e = Math.max(e, kickEnergy[idx]);
      }
    }
    beatEnergies.push(e);
  }

  const sortedE = [...beatEnergies].sort((a, b) => a - b);
  const medianE = sortedE[Math.floor(sortedE.length * 0.7)] || 0;
  const threshold = Math.max(0.005, medianE * 0.12);

  let firstBarTime = phase0;
  for (let k = 0; k < maxBeats; k++) {
    if (beatEnergies[k] >= threshold) {
      firstBarTime = phase0 + k * beatSec;
      break;
    }
  }

  return {
    bpm: finalBpm,
    firstBeat: positiveMod(firstBarTime, beatSec),
    firstBar: firstBarTime,
    beatsPerBar: 4,
  };
}

function subtractMovingMean(x, half) {
  const n = x.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const mean = (prefix[b] - prefix[a]) / (b - a);
    x[i] = Math.max(0, x[i] - mean);
  }
}

function testBpm(targetBpm) {
  const sr = 22050;
  const duration = 20;
  const beatSec = 60 / targetBpm;
  const numSamples = Math.floor(sr * duration);
  const audio = new Float32Array(numSamples);

  const introSilence = 1.2; // 1.2s intro silence
  for (let t = introSilence; t < duration; t += beatSec) {
    const startSample = Math.floor(t * sr);
    const kickLen = Math.floor(sr * 0.05);
    for (let i = 0; i < kickLen && startSample + i < numSamples; i++) {
      const env = Math.exp(-i / (sr * 0.015));
      const freq = 130 * (1 - i / kickLen) + 45;
      audio[startSample + i] += 0.9 * env * Math.sin((2 * Math.PI * freq * i) / sr);
    }
  }

  const res = analyzeMixxxBeatGrid(audio, sr);
  console.log(`Target: ${targetBpm} BPM -> Detected: ${res.bpm} BPM | firstBar: ${res.firstBar.toFixed(3)}s`);
  assert(Math.abs(res.bpm - targetBpm) < 0.6, `Error for target ${targetBpm}, got ${res.bpm}`);
}

[120.0, 124.0, 126.5, 128.0, 130.0, 140.0, 174.0].forEach(testBpm);

// Test high-frequency intro (hi-hats / synth lead) before first kick at 2.0s
function testIntroWithHighFrequencyLead() {
  const sr = 22050;
  const duration = 20;
  const targetBpm = 128.0;
  const beatSec = 60 / targetBpm;
  const numSamples = Math.floor(sr * duration);
  const audio = new Float32Array(numSamples);

  // High-frequency hi-hat count-in during 0s - 2.0s (e.g. at 0.5s, 1.0s, 1.5s)
  for (let t = 0.5; t < 2.0; t += 0.5) {
    const startSample = Math.floor(t * sr);
    for (let i = 0; i < 500; i++) {
      audio[startSample + i] += 0.6 * Math.sin((2 * Math.PI * 4500 * i) / sr);
    }
  }

  // First kick drops at 2.0s
  for (let t = 2.0; t < duration; t += beatSec) {
    const startSample = Math.floor(t * sr);
    const kickLen = Math.floor(sr * 0.05);
    for (let i = 0; i < kickLen && startSample + i < numSamples; i++) {
      const env = Math.exp(-i / (sr * 0.015));
      const freq = 130 * (1 - i / kickLen) + 45;
      audio[startSample + i] += 0.9 * env * Math.sin((2 * Math.PI * freq * i) / sr);
    }
  }

  const res = analyzeMixxxBeatGrid(audio, sr);
  console.log(`High-freq intro test: 128 BPM -> Detected: ${res.bpm} BPM | firstBar: ${res.firstBar.toFixed(3)}s`);
  assert(Math.abs(res.bpm - 128.0) < 0.6, `Error: got ${res.bpm}`);
  assert(Math.abs(res.firstBar - 2.0) < 0.08, `Expected firstBar ~2.0s, got ${res.firstBar}`);
  console.log('Passed noisy intro test: correctly locked Beat 1 to first kick drop at 2.0s!');
}

testIntroWithHighFrequencyLead();
console.log('All BPM tests passed with flying colors!');
