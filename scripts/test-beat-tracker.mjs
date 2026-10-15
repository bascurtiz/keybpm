import assert from 'node:assert';
import {
  LOG_BAND_COUNT,
  LOG_BAND_MIN_HZ,
  LOW_GROUP_HZ,
  buildLogBandLayout,
  computeOnsetEnvelope,
  frameToSeconds,
  secondsToFrame,
  suppressBackground,
  standardDeviation,
} from '../src/lib/dj/spectral-flux.ts';
import {
  beatConfidenceFrom,
  deriveBpmInterpretation,
  normalizeDjBpm,
  trackBeats,
} from '../src/lib/dj/beat-tracker.ts';

let checks = 0;
function ok(cond, message) {
  checks++;
  assert.ok(cond, message);
}
function near(actual, expected, tol, message) {
  checks++;
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${message} (expected ${expected} +/- ${tol}, got ${actual})`
  );
}

/** Deterministic PRNG so the wobble tests never flake. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SR = 22050;

/**
 * A synthetic track: a kick (low sine burst) on every beat, an offbeat hat
 * (short high-frequency burst), optional per-beat time jitter and a tempo that
 * may drift. Returns the mono signal plus the true kick times.
 */
function clickTrack({ duration, bpmAtTime, jitter = 0, seed = 1, kickLevel = 0.8 }) {
  const length = Math.floor(duration * SR);
  const mono = new Float32Array(length);
  const rand = rng(seed);
  const beats = [];
  let t = 0.4;
  let index = 0;
  while (t < duration - 0.1) {
    beats.push(t);
    t += 60 / bpmAtTime(t);
  }

  const addBurst = (time, freq, decay, level, noise) => {
    const start = Math.round(time * SR);
    const n = Math.round(decay * SR);
    const r = rng(Math.round(time * 7919) + 13);
    for (let i = 0; i < n && start + i < length; i++) {
      if (start + i < 0) continue;
      const env = Math.exp(-i / (decay * SR * 0.25));
      const v = Math.sin((2 * Math.PI * freq * i) / SR) + (r() - 0.5) * noise;
      mono[start + i] += v * env * level;
    }
  };

  for (let k = 0; k < beats.length; k++) {
    const jittered = beats[k] + (jitter > 0 ? (rand() - 0.5) * jitter : 0);
    addBurst(jittered, 55, 0.09, kickLevel, 0.5);
    // Offbeat hat at 55% into the beat, so it sits between the kicks.
    addBurst(jittered + (60 / bpmAtTime(beats[k])) * 0.5, 7000, 0.012, 0.25, 1.2);
    index++;
  }
  return { mono, beats };
}

function nearestError(times, truth) {
  const sorted = [...truth].sort((a, b) => a - b);
  let worst = 0;
  for (const t of times) {
    let best = Infinity;
    for (const u of sorted) {
      const d = Math.abs(t - u);
      if (d < best) best = d;
      if (u > t + 1) break;
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Log-band layout
// ---------------------------------------------------------------------------
{
  const layout = buildLogBandLayout(SR, 1024);
  ok(layout.bandCount === LOG_BAND_COUNT, `the layout has ${LOG_BAND_COUNT} log-spaced bands`);
  ok(layout.starts[0] === 1, 'the first band starts above DC so rumble folds into it');
  near(layout.centres[0], Math.sqrt(LOG_BAND_MIN_HZ * LOG_BAND_MIN_HZ * Math.pow(22050 / 2 / LOG_BAND_MIN_HZ, 1 / 24)), 2, 'the first band centre is near the log-spaced edge');
  ok(layout.ends[layout.bandCount - 1] <= 511, 'the last band stays inside the real spectrum');
  ok(layout.ends[layout.bandCount - 1] >= 480, 'the last band reaches Nyquist');

  let monotonic = true;
  let covers = true;
  for (let b = 0; b < layout.bandCount; b++) {
    if (layout.ends[b] < layout.starts[b]) monotonic = false;
    if (layout.widths[b] < 1) monotonic = false;
    if (b > 0 && layout.starts[b] < layout.starts[b - 1]) monotonic = false;
    if (b > 0 && layout.centres[b] <= layout.centres[b - 1]) monotonic = false;
  }
  ok(monotonic, 'bands are ordered, non-empty and non-overlapping');
  // Log spacing means the bands get wider with frequency, so high bands win on
  // bin count — the opposite of a linear split, where the low bands would all
  // collapse into one or two bins.
  ok(layout.widths[layout.bandCount - 1] > layout.widths[0], 'log spacing gives high bands more bins');

  let binSum = 0;
  for (let b = 0; b < layout.bandCount; b++) binSum += layout.widths[b];
  covers = binSum >= 500 && binSum <= 511 * 2;
  ok(covers, `the bands cover the spectrum (${binSum} bins counted)`);

  ok(layout.lowGroupEnd >= 1, 'the low group holds at least one band');
  for (let b = 0; b < layout.lowGroupEnd; b++) {
    ok(layout.centres[b] < LOW_GROUP_HZ, `band ${b} is inside the low (< ${LOW_GROUP_HZ} Hz) group`);
  }
  ok(layout.centres[layout.lowGroupEnd] >= LOW_GROUP_HZ, 'the low group stops at the kick/bass edge');

  // A 48 kHz context must produce a different, still-valid layout that reaches
  // its own (higher) Nyquist rather than stopping at 22.05 kHz.
  const layout48 = buildLogBandLayout(48000, 1024);
  ok(
    layout48.centres[layout48.bandCount - 1] > 15000,
    `a 48 kHz layout reaches its own Nyquist (top band centre ${Math.round(layout48.centres[layout48.bandCount - 1])} Hz)`
  );
  ok(layout48.ends[layout48.bandCount - 1] === 511, 'a 48 kHz layout ends at the last real bin');
  ok(layout48.starts[0] === 1, 'a 48 kHz layout also folds sub-40 Hz into band 0');
  ok(
    layout48.widths[layout48.bandCount - 1] > layout.widths[layout.bandCount - 1],
    'the 48 kHz bands are wider in bins than the 44.1 kHz ones'
  );
}

// ---------------------------------------------------------------------------
// Onset envelope
// ---------------------------------------------------------------------------
{
  const { mono, beats } = clickTrack({ duration: 12, bpmAtTime: () => 128 });
  const env = computeOnsetEnvelope(mono, SR);
  ok(env !== null, 'an onset envelope is produced for a percussive track');
  ok(env.frames > 500, `the envelope covers the track (${env.frames} frames)`);
  near(env.envRate, SR / 128, 0.001, 'the envelope rate is sampleRate / hop');
  ok(env.layout.bandCount === LOG_BAND_COUNT, 'the envelope reports its band layout');

  let sum = 0;
  let lowSum = 0;
  let lowGreater = 0;
  for (let i = 0; i < env.frames; i++) {
    sum += env.odf[i];
    lowSum += env.lowOdf[i];
    if (env.lowOdf[i] > env.odf[i]) lowGreater++;
  }
  ok(sum > 0, 'the onset envelope is not silent on a percussive track');
  ok(lowSum > 0, 'the low (kick) envelope sees the kick drum');
  ok(lowGreater === 0, 'the low group is a subset of the total flux');
  ok(lowSum < sum, 'the total flux is the sum over all bands, so it exceeds the low group');

  // The kick must actually register: the envelope peaks near each true beat.
  let onBeat = 0;
  for (const beat of beats) {
    const centre = Math.round(beat * env.envRate);
    let peak = 0;
    for (let w = -6; w <= 6; w++) {
      const idx = centre + w;
      if (idx >= 0 && idx < env.frames && env.lowOdf[idx] > peak) peak = env.lowOdf[idx];
    }
    if (peak > 0) onBeat++;
  }
  ok(onBeat === beats.length, `every kick shows up in the low envelope (${onBeat}/${beats.length})`);

  // Half-wave rectification: the envelope can never go negative.
  let negative = 0;
  for (let i = 0; i < env.frames; i++) if (env.odf[i] < 0) negative++;
  ok(negative === 0, 'half-wave rectified flux is never negative');

  // A silent signal produces an empty envelope rather than throwing.
  const silent = computeOnsetEnvelope(new Float32Array(SR * 2), SR);
  ok(silent !== null, 'a silent buffer still produces an envelope');
  let silentSum = 0;
  for (let i = 0; i < silent.frames; i++) silentSum += silent.odf[i];
  near(silentSum, 0, 1e-6, 'a silent buffer has no onset energy');

  ok(computeOnsetEnvelope(new Float32Array(200), SR) === null, 'too little audio is rejected');
}

// ---------------------------------------------------------------------------
// Background suppression and std helper
// ---------------------------------------------------------------------------
{
  const x = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  suppressBackground(x, 1);
  ok(x[1] > 0, 'an isolated spike survives background suppression');
  let min = Infinity;
  for (const v of x) min = Math.min(min, v);
  ok(min >= 0, 'background suppression never produces a negative value');

  near(standardDeviation(new Float32Array([2, 2, 2, 2])), 0, 1e-9, 'a constant signal has no spread');
  near(standardDeviation(new Float32Array([0, 2, 0, 2])), Math.sqrt(4 / 3), 1e-6, 'the spread is the sample standard deviation');
  near(standardDeviation(new Float32Array([0, 0, 5, 5]), { from: 2, to: 4 }), 0, 1e-9, 'the spread can be measured on a slice');
}

// ---------------------------------------------------------------------------
// Ellis DP: a steady track
// ---------------------------------------------------------------------------
{
  const { mono, beats } = clickTrack({ duration: 24, bpmAtTime: () => 128 });
  const env = computeOnsetEnvelope(mono, SR);
  const result = trackBeats(env.odf, env.envRate, { bpm: 128 });
  ok(result !== null, 'the DP tracker returns a path for a steady track');
  ok(result.beatFrames.length >= 40, `a 24s track yields a full beat train (${result.beatFrames.length} beats)`);

  near(result.fitBpm, 128, 0.6, 'the fitted tempo recovers the true BPM');
  ok(result.residualLogRms < 0.03, `a steady track has a small log-period residual (${result.residualLogRms})`);
  ok(result.contrast > 1, `onsets on the grid are stronger than the average (contrast ${result.contrast})`);
  ok(result.retainedRatio > 0.8, `most tracked beats survive outlier rejection (${result.retainedRatio})`);
  ok(result.confidence > 0.5, `a clean 4/4 track scores a high confidence (${result.confidence})`);

  // Every tracked beat must land on a real kick, not between them.
  const times = result.beatFrames.map(f => frameToSeconds(f, SR));
  const worst = nearestError(times, beats);
  ok(worst < 0.04, `every tracked beat lands on a kick (worst ${(worst * 1000).toFixed(1)}ms)`);

  // Ascending, unique frames.
  let ascending = true;
  for (let i = 1; i < result.beatFrames.length; i++) {
    if (result.beatFrames[i] <= result.beatFrames[i - 1]) ascending = false;
  }
  ok(ascending, 'the tracked beat train is strictly increasing');
}

// ---------------------------------------------------------------------------
// Ellis DP: wobble (a real drummer) — the case a rigid lattice gets wrong
// ---------------------------------------------------------------------------
{
  const { mono, beats } = clickTrack({ duration: 30, bpmAtTime: () => 128, jitter: 0.05, seed: 424242 });
  const env = computeOnsetEnvelope(mono, SR);
  const result = trackBeats(env.odf, env.envRate, { bpm: 128 });
  ok(result !== null, 'the DP tracker survives jittered timing');

  const times = result.beatFrames.map(f => frameToSeconds(f, SR));
  const worst = nearestError(times, beats);
  ok(worst < 0.06, `the tracked path follows humanised timing (worst ${(worst * 1000).toFixed(1)}ms)`);
  // The geometry convention must round trip, since every consumer relies on it.
  for (const f of [0, 1, 63, 1000]) {
    near(secondsToFrame(frameToSeconds(f, SR), SR), f, 1e-9, `frame ${f} round trips through time`);
  }

  // The residual must *report* the wobble rather than staying silent about it.
  const steady = clickTrack({ duration: 30, bpmAtTime: () => 128, seed: 7 });
  const steadyEnv = computeOnsetEnvelope(steady.mono, SR);
  const steadyResult = trackBeats(steadyEnv.odf, steadyEnv.envRate, { bpm: 128 });
  ok(
    result.residualLogRms > steadyResult.residualLogRms,
    `jitter is visible in the residual (${result.residualLogRms} vs ${steadyResult.residualLogRms})`
  );
  ok(
    result.confidence <= steadyResult.confidence,
    `jitter lowers the confidence (${result.confidence} vs ${steadyResult.confidence})`
  );
}

// ---------------------------------------------------------------------------
// Ellis DP: drift — this is the case the old rigid lattice could not hold
// ---------------------------------------------------------------------------
{
  const duration = 90;
  // 128 -> 124 BPM: a live band easing off, or a vinyl rip warping.
  const drift = t => 128 - (4 * t) / duration;
  const { mono, beats } = clickTrack({ duration, bpmAtTime: drift });

  // What the previous approach did: one global tempo, one rigid lattice phase.
  const rigidTempo = 126;
  let rigidWorst = 0;
  for (let k = 0; k < beats.length; k++) {
    const rigid = beats[0] + (k * 60) / rigidTempo;
    rigidWorst = Math.max(rigidWorst, Math.abs(rigid - beats[k]));
  }
  // 0.355s is over a third of a beat at 124 BPM, i.e. audibly off-grid by the
  // outro — which is exactly the failure the constant-tempo grid had.
  ok(rigidWorst > 0.25, `a rigid lattice at the mid-tempo drifts audibly (worst ${rigidWorst.toFixed(3)}s)`);

  const env = computeOnsetEnvelope(mono, SR);
  const result = trackBeats(env.odf, env.envRate, { bpm: rigidTempo });
  ok(result !== null, 'the DP tracker runs on a drifting track');
  const times = result.beatFrames.map(f => frameToSeconds(f, SR));
  const worst = nearestError(times, beats);
  ok(
    worst < 0.06,
    `the DP holds a drifting track where the lattice drifts 0.5s (worst ${(worst * 1000).toFixed(1)}ms)`
  );
  ok(
    worst < rigidWorst / 5,
    `the DP is far better than the rigid lattice (${(worst * 1000).toFixed(1)}ms vs ${(rigidWorst * 1000).toFixed(0)}ms)`
  );
  // A single straight line cannot fit a drifting train, and the residual says so.
  const steadyRef = clickTrack({ duration, bpmAtTime: () => 126, seed: 21 });
  const steadyRefEnv = computeOnsetEnvelope(steadyRef.mono, SR);
  const steadyRefResult = trackBeats(steadyRefEnv.odf, steadyRefEnv.envRate, { bpm: rigidTempo });
  ok(
    result.residualLogRms > steadyRefResult.residualLogRms,
    `drift raises the residual (${result.residualLogRms} vs ${steadyRefResult.residualLogRms})`
  );
  ok(result.beatFrames.length > beats.length * 0.9, 'most beats of the drift are tracked');
}

// ---------------------------------------------------------------------------
// Ellis DP: the confidence actually discriminates periodicity
// ---------------------------------------------------------------------------
{
  // Irregular onsets: same number of kicks, no stable period.
  const rand = rng(99);
  const length = Math.floor(30 * SR);
  const mono = new Float32Array(length);
  let t = 0.4;
  while (t < 29) {
    const start = Math.round(t * SR);
    const n = Math.round(0.09 * SR);
    for (let i = 0; i < n && start + i < length; i++) {
      mono[start + i] += Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp(-i / (0.09 * SR * 0.25)) * 0.8;
    }
    t += 0.2 + rand() * 0.8;
  }
  const env = computeOnsetEnvelope(mono, SR);
  const erratic = trackBeats(env.odf, env.envRate, { bpm: 128 });
  const steady = clickTrack({ duration: 30, bpmAtTime: () => 128 });
  const steadyEnv = computeOnsetEnvelope(steady.mono, SR);
  const steadyResult = trackBeats(steadyEnv.odf, steadyEnv.envRate, { bpm: 128 });

  ok(erratic !== null && steadyResult !== null, 'both tracks are trackable');
  ok(
    erratic.confidence < steadyResult.confidence,
    `erratic timing scores lower than a steady 4/4 (${erratic.confidence} vs ${steadyResult.confidence})`
  );
  ok(
    erratic.residualLogRms > steadyResult.residualLogRms,
    `erratic timing has a larger residual (${erratic.residualLogRms} vs ${steadyResult.residualLogRms})`
  );
}

// ---------------------------------------------------------------------------
// Ellis DP: degenerate inputs
// ---------------------------------------------------------------------------
{
  ok(trackBeats(new Float32Array(10), 172, { bpm: 128 }) === null, 'an envelope shorter than the period is rejected');
  ok(trackBeats(new Float32Array(4000), 172, { bpm: 0 }) === null, 'a missing tempo is rejected');
  ok(trackBeats(new Float32Array(4000), 0, { bpm: 128 }) === null, 'a missing frame rate is rejected');

  const silent = trackBeats(new Float32Array(4000), 172, { bpm: 128 });
  ok(silent === null, 'silence yields no beat path rather than a fabricated one');
}

// ---------------------------------------------------------------------------
// Confidence formula
// ---------------------------------------------------------------------------
{
  near(beatConfidenceFrom(0, 4, 1), 1, 1e-9, 'a perfect, strongly supported track scores 1');
  ok(beatConfidenceFrom(0.5, 4, 1) < 0.2, 'a large residual collapses the confidence');
  ok(beatConfidenceFrom(0.01, 0.1, 1) < 0.1, 'a grid with no onset support scores low');
  ok(beatConfidenceFrom(0.01, 4, 0.1) < 0.2, 'a mostly-rejected beat train scores low');
  near(beatConfidenceFrom(-1, 4, 1), beatConfidenceFrom(0, 4, 1), 1e-9, 'a negative residual clamps to a perfect score');
  for (const r of [-1, 0, 0.005, 0.04, 0.2, 5]) {
    for (const c of [0, 0.5, 2, 40]) {
      const value = beatConfidenceFrom(r, c, 1);
      ok(value >= 0 && value <= 1, `the confidence stays in [0,1] (residual ${r}, contrast ${c} -> ${value})`);
    }
  }
}

// ---------------------------------------------------------------------------
// DJ BPM normalisation: visible and reversible
// ---------------------------------------------------------------------------
{
  const octaveUp = normalizeDjBpm(80);
  near(octaveUp.bpm, 160, 1e-9, 'a half-tempo reading is doubled');
  near(octaveUp.rawBpm, 80, 1e-9, 'the raw measurement is kept');
  near(octaveUp.multiplier, 2, 1e-9, 'the doubling is recorded');
  near(
    normalizeDjBpm(84.9).multiplier,
    2,
    1e-9,
    'just under the doubling threshold is still doubled'
  );
  near(
    normalizeDjBpm(87.5).multiplier,
    1,
    1e-9,
    'a 87.5 BPM reading is past the doubling threshold, so it is left as measured'
  );
  near(normalizeDjBpm(87.5).rawBpm, 87.5, 1e-9, 'an untouched tempo still reports its raw value');

  const octaveDown = normalizeDjBpm(200);
  near(octaveDown.bpm, 100, 1e-9, 'a double-tempo reading is halved');
  near(octaveDown.multiplier, 0.5, 1e-9, 'the halving is recorded');

  const untouched = normalizeDjBpm(128);
  near(untouched.bpm, 128, 1e-9, 'a normal tempo is left alone');
  near(untouched.multiplier, 1, 1e-9, 'no multiplier is recorded when none was applied');

  const edgeLow = normalizeDjBpm(85);
  near(edgeLow.multiplier, 1, 1e-9, 'the doubling threshold is exclusive');
  const edgeHigh = normalizeDjBpm(185);
  near(edgeHigh.multiplier, 1, 1e-9, 'the halving threshold is exclusive');

  // The whole point: raw = bpm / multiplier, for every input.
  for (const raw of [40, 55, 60, 70, 84.9, 85, 100, 120, 128.5, 174, 185, 186, 195, 200, 240]) {
    const n = normalizeDjBpm(raw);
    near(n.bpm / n.multiplier, raw, 1e-6, `raw BPM is recoverable from ${raw}`);
  }

  // Invalid input must not produce NaN or throw.
  const bad = normalizeDjBpm(0);
  near(bad.multiplier, 1, 1e-9, 'a zero BPM is not normalised');
  ok(Number.isFinite(normalizeDjBpm(NaN).bpm) === false, 'a NaN BPM stays NaN rather than becoming a number');
}

// ---------------------------------------------------------------------------
// BPM interpretation: how a stored tempo relates to what was measured
// ---------------------------------------------------------------------------
{
  const doubled = deriveBpmInterpretation(87.5, 175);
  near(doubled.multiplier, 2, 1e-9, 'a stored 175 against a measured 87.5 is a doubling');
  near(doubled.rawBpm, 87.5, 1e-9, 'the measured tempo is reported');

  const halved = deriveBpmInterpretation(200, 100);
  near(halved.multiplier, 0.5, 1e-9, 'a stored 100 against a measured 200 is a halving');

  near(
    deriveBpmInterpretation(128, 128).multiplier,
    1,
    1e-9,
    'an unchanged tempo reports no octave interpretation'
  );
  near(
    deriveBpmInterpretation(128, 128.4).multiplier,
    1,
    1e-9,
    'a small cross-check adjustment is not mistaken for an octave change'
  );
  near(
    deriveBpmInterpretation(64.2, 128.4).multiplier,
    2,
    1e-9,
    'a doubling within tolerance is recognised'
  );
  near(
    deriveBpmInterpretation(174, 87).multiplier,
    0.5,
    1e-9,
    'a halving within tolerance is recognised'
  );

  // The documented invariant: the measurement is recoverable from the stored
  // value and the multiplier.
  for (const [measured, stored] of [
    [87.5, 175],
    [200, 100],
    [128, 128],
    [64, 128],
    [174, 87],
    [90, 180],
  ]) {
    const out = deriveBpmInterpretation(measured, stored);
    near(out.rawBpm, measured, 1e-6, `the measured tempo ${measured} survives`);
    if (out.multiplier !== 1) {
      near(
        stored / out.multiplier,
        out.rawBpm,
        0.02 * out.rawBpm,
        `the stored tempo ${stored} reverses to its measurement`
      );
    }
  }

  // Degenerate input must not invent an interpretation.
  near(deriveBpmInterpretation(0, 175).multiplier, 1, 1e-9, 'a zero measurement is not interpreted');
  near(deriveBpmInterpretation(120, 0).multiplier, 1, 1e-9, 'a zero stored tempo is not interpreted');
  near(deriveBpmInterpretation(NaN, 120).multiplier, 1, 1e-9, 'a NaN measurement is not interpreted');
  near(deriveBpmInterpretation(120, Infinity).multiplier, 1, 1e-9, 'an infinite stored tempo is not interpreted');
}

console.log(`beat tracker tests passed (${checks} assertions)`);
