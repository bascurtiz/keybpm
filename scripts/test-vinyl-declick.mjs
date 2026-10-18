import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

/**
 * The vinyl worklet's read head is jumped by sync's bar alignment, seeks, hot cues and beat
 * jumps. Stepping it in one sample is a discontinuity in the waveform and therefore a click —
 * the loudest one the deck can make, since bar alignment can move the head by most of a bar.
 *
 * These checks render the real processor (pulled out of `vinyl-worklet.ts` and run in a VM with
 * the two globals an AudioWorklet gives it) and measure the sample-to-sample step across a jump.
 * An undeclicked jump on a 220 Hz sine steps by up to the peak-to-peak amplitude; the crossfade
 * keeps every step within a small multiple of the sine's own slope.
 */

const SAMPLE_RATE = 44100;
const QUANTUM = 128;
const DECLICK_FRAMES = Math.round((4 / 1000) * SAMPLE_RATE);

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

// ---------------------------------------------------------------------------
// The processor, lifted out of the TypeScript module
// ---------------------------------------------------------------------------
const moduleSource = fs.readFileSync(
  new URL('../src/lib/dj/vinyl-worklet.ts', import.meta.url),
  'utf8'
);
const start = moduleSource.indexOf('/* js */ `');
assert.ok(start > 0, 'PROCESSOR_SOURCE marker is still in vinyl-worklet.ts');
const end = moduleSource.lastIndexOf('`');
assert.ok(end > start, 'PROCESSOR_SOURCE is a closed template literal');
const processorSource = moduleSource.slice(start + '/* js */ `'.length, end);

function createProcessor() {
  let Registered = null;
  const sandbox = {
    sampleRate: SAMPLE_RATE,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      constructor() {
        this.messages = [];
        this.port = {
          onmessage: null,
          postMessage: (message) => this.messages.push(message),
        };
      }
    },
    registerProcessor: (_name, ctor) => {
      Registered = ctor;
    },
    Math,
    Float32Array,
    Array,
    Object,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(processorSource, sandbox, { filename: 'vinyl-worklet-processor.js' });
  assert.ok(Registered, 'the vinyl worklet registered a processor');
  return new Registered();
}

/** A mono sine whose samples the test also keeps, so the *unfixed* step can be measured. */
function loadSine(proc, { freq = 220, amplitude = 0.5, seconds = 2 } = {}) {
  const length = SAMPLE_RATE * seconds;
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  }
  proc.port.onmessage({
    data: {
      t: 'load',
      channels: [samples.slice().buffer],
      length,
      rate: SAMPLE_RATE,
      initialSec: 0,
      hz: 60,
    },
  });
  return samples;
}

function send(proc, message) {
  proc.port.onmessage({ data: message });
}

/** Renders `quanta` render quanta and returns every output sample, both channels. */
function render(proc, quanta) {
  const left = new Float32Array(QUANTUM);
  const right = new Float32Array(QUANTUM);
  const out = [];
  for (let q = 0; q < quanta; q++) {
    proc.process([], [[left, right]]);
    for (let i = 0; i < QUANTUM; i++) out.push(left[i]);
  }
  return out;
}

function maxStep(samples, from = 1) {
  let max = 0;
  for (let i = from; i < samples.length; i++) {
    const step = Math.abs(samples[i] - samples[i - 1]);
    if (step > max) max = step;
  }
  return max;
}

const FREQ = 220;
const AMPLITUDE = 0.5;
/** The sine's own steepest sample-to-sample step. Nothing legitimate should exceed it by much. */
const SLOPE = ((AMPLITUDE * 2 * Math.PI * FREQ) / SAMPLE_RATE) * 1.05;

// ---------------------------------------------------------------------------
// A jump while playing is crossfaded, not stepped
// ---------------------------------------------------------------------------
{
  const proc = createProcessor();
  const samples = loadSine(proc, { freq: FREQ, amplitude: AMPLITUDE });
  send(proc, { t: 'play', rate: 1 });

  // Let the platter's rate smoothing settle, so one sample is one frame and the position
  // assertion below is exact rather than "roughly a window".
  render(proc, 100);
  const posBefore = proc.pos;
  near(posBefore, 100 * QUANTUM, 1e-6, 'the deck is up to speed');

  const before = render(proc, 20);
  const rendered = 20 * QUANTUM;
  const shiftSeconds = 0.37;
  const posAtJump = proc.pos;
  near(posAtJump, posBefore + rendered, 1e-6, 'the deck advanced a full window before the jump');
  const target = posAtJump + shiftSeconds * SAMPLE_RATE;

  send(proc, { t: 'shift', s: shiftSeconds });
  ok(proc.jump !== null, 'a jump while playing starts a crossfade instead of landing at once');
  near(proc.jump.fade, DECLICK_FRAMES, 1, 'the crossfade is ~4 ms long');

  const after = render(proc, 20);
  const all = before.concat(after);

  // What the step would have been with no declick: the waveform jumps from one sample of the
  // old position straight to one of the new one.
  const rawStep = Math.abs(samples[Math.round(target)] - samples[Math.round(posAtJump)]);
  ok(rawStep > SLOPE * 10, `the undeclicked step would be large (${rawStep.toFixed(3)})`);

  ok(maxStep(all) < SLOPE * 2, `no step larger than twice the signal's own slope (${maxStep(all).toFixed(4)})`);

  // The fade finishes on the new timeline: the jump lands on the target and the deck then
  // plays on from there for the rest of the window, exactly as if it had always been there.
  ok(proc.jump === null, 'the crossfade ends within the rendered window');
  near(proc.pos, target + rendered, 2, 'the read head lands on the target and plays on from it');

  // ...and the deck is still playing afterwards, not silent.
  const tail = after.slice(-QUANTUM * 4);
  const rms = Math.sqrt(tail.reduce((sum, v) => sum + v * v, 0) / tail.length);
  ok(rms > AMPLITUDE * 0.5, `audio resumes at full level after the jump (rms ${rms.toFixed(3)})`);
}

// ---------------------------------------------------------------------------
// A seek while playing is declicked the same way, and still reaches the target
// ---------------------------------------------------------------------------
{
  const proc = createProcessor();
  const samples = loadSine(proc, { freq: FREQ, amplitude: AMPLITUDE });
  send(proc, { t: 'play', rate: 1 });
  render(proc, 100);

  const seekTo = 1.4;
  const posBefore = proc.pos;
  send(proc, { t: 'seek', s: seekTo });
  ok(proc.jump !== null, 'a seek while playing is crossfaded');

  const out = render(proc, 14);
  const rawStep = Math.abs(
    samples[Math.round(seekTo * SAMPLE_RATE)] - samples[Math.round(posBefore)]
  );
  ok(rawStep > SLOPE * 10, `the undeclicked seek step would be large (${rawStep.toFixed(3)})`);
  ok(maxStep(out) < SLOPE * 2, 'a seek does not step the waveform');

  near(proc.pos, seekTo * SAMPLE_RATE + 14 * QUANTUM, 2, 'the seek lands on its target');
}

// ---------------------------------------------------------------------------
// Nothing to hide: a stopped deck lands immediately, at the exact sample
// ---------------------------------------------------------------------------
{
  const proc = createProcessor();
  loadSine(proc);
  send(proc, { t: 'seek', s: 1.234 });

  ok(proc.jump === null, 'a stopped deck does not crossfade a seek');
  near(proc.pos, 1.234 * SAMPLE_RATE, 0, 'a stopped deck lands exactly on the seek target');

  // And the next play starts from there rather than fading in from anywhere else.
  send(proc, { t: 'play', rate: 1 });
  render(proc, 1);
  ok(proc.pos > 1.234 * SAMPLE_RATE, 'playback continues from the seek target');
}

// ---------------------------------------------------------------------------
// Two jumps inside one crossfade compose instead of cutting the outgoing stream
// ---------------------------------------------------------------------------
{
  const proc = createProcessor();
  loadSine(proc, { freq: FREQ, amplitude: AMPLITUDE });
  send(proc, { t: 'play', rate: 1 });
  render(proc, 100);
  const before = render(proc, 10);
  const posBefore = proc.pos;

  send(proc, { t: 'shift', s: 0.2 });
  const intoFirstFade = render(proc, 1); // part-way into the first fade
  send(proc, { t: 'shift', s: 0.1 });

  const after = render(proc, 24);
  const all = before.concat(intoFirstFade, after);
  ok(maxStep(all) < SLOPE * 2, 'a queued jump keeps the output continuous');
  ok(proc.jump === null, 'both jumps finish');
  // Both shifts land, but a jump queued behind a fade keeps the target it was given when it
  // was asked for, so it is short by the quantum that played in the meantime. Three
  // milliseconds is far below anything a bar alignment can be heard against.
  near(
    proc.pos,
    posBefore + (0.2 + 0.1) * SAMPLE_RATE + (1 + 24) * QUANTUM,
    2 * QUANTUM,
    'both shifts are applied in full'
  );
}

// ---------------------------------------------------------------------------
// Pausing mid-crossfade lands the jump instead of resuming it on the next play
// ---------------------------------------------------------------------------
{
  const proc = createProcessor();
  loadSine(proc);
  send(proc, { t: 'play', rate: 1 });
  render(proc, 100);
  send(proc, { t: 'shift', s: 0.5 });
  render(proc, 1);
  const pending = proc.jump;
  ok(pending !== null, 'the crossfade is in flight');

  send(proc, { t: 'pause', instant: true });
  ok(proc.jump === null, 'pausing clears the pending crossfade');
  near(proc.pos, Math.min(pending.p, proc.length - 1), 0, 'the paused deck lands on the jump target');
}

// ---------------------------------------------------------------------------
// The playhead report rate is the caller's, so a phone can ask for 30 Hz
// ---------------------------------------------------------------------------
{
  const countReports = (hz, quanta) => {
    const proc = createProcessor();
    const samples = loadSine(proc);
    proc.port.onmessage({
      data: {
        t: 'load',
        channels: [samples.slice().buffer],
        length: samples.length,
        rate: SAMPLE_RATE,
        initialSec: 0,
        hz,
      },
    });
    send(proc, { t: 'play', rate: 1 });
    render(proc, quanta);
    return proc.messages.filter((m) => m && m.t === 'pos').length;
  };

  const quanta = 330; // exactly 30 hops at 30 Hz and 55 at 60 Hz
  const desktop = countReports(60, quanta);
  const handheld = countReports(30, quanta);

  ok(desktop >= 54 && desktop <= 56, `60 Hz asks for a report every 6 quanta (got ${desktop})`);
  ok(handheld >= 29 && handheld <= 31, `30 Hz asks for a report every 11 quanta (got ${handheld})`);
  ok(handheld < desktop * 0.6, 'the hand-held rate is roughly half the desktop one');
}

console.log(`vinyl declick: ${checks} checks passed`);
