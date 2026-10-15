import assert from 'node:assert';
import {
  ODF_HOP,
  ODF_WIN,
  computeOnsetEnvelope,
  frameToSeconds,
  secondsToFrame,
  suppressBackground,
} from '../src/lib/dj/spectral-flux.ts';

let checks = 0;

function check(cond, message) {
  checks++;
  assert.ok(cond, message);
}

/**
 * A kick-like burst: a decaying 60 Hz sine, the shape real dance material puts on
 * the beat. The analyzer's whole job is to put the grid on transients, so the
 * error between where this was written and where the envelope maps it is a
 * systematic error in every stored grid.
 */
function kickBurst(at, sampleRate, seconds = 4) {
  const signal = new Float32Array(Math.floor(sampleRate * seconds));
  const start = Math.floor(at * sampleRate);
  // Defined in seconds, not samples: a fixed sample count is a 36 ms kick at
  // 11 kHz and a 9 ms kick at 44 kHz, which would test two different transients.
  const length = Math.max(64, Math.round(sampleRate * 0.012));
  const decay = sampleRate * 0.0018;
  for (let i = 0; i < length && start + i < signal.length; i++) {
    signal[start + i] += Math.exp(-i / decay) * Math.sin((2 * Math.PI * 60 * i) / sampleRate);
  }
  return signal;
}

/** A click: a single full-scale sample, the sharpest transient there is. */
function click(at, sampleRate, seconds = 4) {
  const signal = new Float32Array(Math.floor(sampleRate * seconds));
  signal[Math.floor(at * sampleRate)] = 1;
  return signal;
}

function peakTime(signal, sampleRate) {
  const env = computeOnsetEnvelope(signal, sampleRate);
  suppressBackground(env.odf, Math.max(2, Math.round(env.envRate * 0.06)));
  let peak = 0;
  let peakIndex = 0;
  for (let i = 0; i < env.frames; i++) {
    if (env.odf[i] > peak) {
      peak = env.odf[i];
      peakIndex = i;
    }
  }
  return { time: frameToSeconds(peakIndex, sampleRate, ODF_HOP, ODF_WIN), peakIndex, env };
}

// ---------------------------------------------------------------------------
// The calibration itself
// ---------------------------------------------------------------------------

const TOLERANCE_MS = 4;
// The rates the analyzer actually sees: 48/44.1 kHz hardware, the 32 kHz and
// 24 kHz families it decimates, and 22.05 kHz, which is what decimation leaves.
for (const sampleRate of [48000, 44100, 32000, 24000, 22050]) {
  for (const at of [0.75, 2.5]) {
    const measured = peakTime(kickBurst(at, sampleRate), sampleRate);
    const errorMs = (measured.time - at) * 1000;
    check(
      Math.abs(errorMs) <= TOLERANCE_MS,
      `kick at ${at}s @ ${sampleRate}Hz: onset mapped to ${measured.time.toFixed(4)}s (${errorMs > 0 ? '+' : ''}${errorMs.toFixed(1)}ms)`
    );
  }
}

// A click is the same problem with less energy below 100 Hz, and must land too.
{
  const at = 1.5;
  const measured = peakTime(click(at, 44100), 44100);
  const errorMs = (measured.time - at) * 1000;
  check(
    Math.abs(errorMs) <= TOLERANCE_MS,
    `click at ${at}s: onset mapped to ${measured.time.toFixed(4)}s (${errorMs > 0 ? '+' : ''}${errorMs.toFixed(1)}ms)`
  );
}

// The bias the calibration removes, stated as a test: the window-centre mapping
// every older grid used is measurably early, and roughly proportional to window
// length, which is why the constant is a fraction of the window rather than a
// fixed number of seconds.
{
  const at = 1.0;
  const measured = peakTime(kickBurst(at, 22050), 22050);
  const centreConvention = (measured.peakIndex * ODF_HOP + ODF_WIN / 2) / 22050;
  const earlyByMs = (at - centreConvention) * 1000;
  check(
    earlyByMs > 8 && earlyByMs < 22,
    `window-centre convention is ${earlyByMs.toFixed(1)}ms early at 22.05kHz (expected 8-22ms)`
  );
}

// Round-tripping must still be exact, or a grid edited in frames would creep.
{
  for (const sampleRate of [44100, 22050]) {
    for (const frame of [0, 1, 123, 4567]) {
      const seconds = frameToSeconds(frame, sampleRate);
      const back = secondsToFrame(seconds, sampleRate);
      check(Math.abs(back - frame) < 1e-9, `frame ${frame} round-trip @ ${sampleRate}Hz gave ${back}`);
    }
  }
}

// An offset window (the analyzer analyses the loudest 120s slice) must shift with
// the offset, because that is how the phase anchor is expressed in track time.
{
  const sampleRate = 22050;
  const measured = peakTime(kickBurst(1.0, sampleRate), sampleRate);
  const shifted = frameToSeconds(measured.peakIndex, sampleRate, ODF_HOP, ODF_WIN, 30);
  check(
    Math.abs(shifted - (measured.time + 30)) < 1e-9,
    `offset window misplaced the onset: ${shifted} vs ${measured.time + 30}`
  );
}

console.log(`onset latency tests passed (${checks} assertions)`);
