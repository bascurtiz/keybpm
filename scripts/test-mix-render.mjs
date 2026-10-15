import assert from 'node:assert';
import {
  buildSegments,
  compressControls,
  deckControlDiffers,
  SEGMENT_RATE_TOLERANCE,
} from '../src/lib/dj/mix-timeline.ts';
import {
  pitchShiftTo,
  planarSink,
  stretchHoldFrames,
  timeStretchTo,
} from '../src/lib/dj/offline-stretch.ts';
import { bytesPerSample, encodeWavPlanar, readWavHeader } from '../src/lib/dj/wav.ts';

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

const SR = 48000;

/** Sampled deck state at a fixed period, built from an explicit position track. */
function samples(points, period) {
  return points.map((p, i) => ({
    t: i * period,
    position: p.position,
    playing: p.playing !== false,
    rate: p.rate ?? 1,
    keyLock: p.keyLock === undefined ? true : p.keyLock,
    keyShift: p.keyShift ?? 0,
    trackIndex: p.trackIndex ?? 0,
  }));
}

/** Constant-speed playback for `seconds`, sampled every `period`. */
function steady(seconds, speed, period, extra = {}) {
  const count = Math.floor(seconds / period);
  const points = [];
  for (let i = 0; i <= count; i++) {
    points.push({ position: i * period * speed, rate: speed, ...extra });
  }
  return samples(points, period);
}

/** Quantise a position to the audio render quantum, as the live deck reports it. */
const QUANTUM = 128 / 48000;
function quantised(seconds) {
  return Math.floor(seconds / QUANTUM) * QUANTUM;
}

// ---------------------------------------------------------------- segments

{
  const period = 0.02;
  const segs = buildSegments(steady(10, 1, period), { period, endTime: 10 });
  ok(segs.length === 1, `steady playback is one segment (got ${segs.length})`);
  near(segs[0].speed, 1, 0.001, 'steady segment speed');
  near(segs[0].duration, 10, 0.05, 'steady segment duration');
  near(segs[0].sourceStart, 0, 0.001, 'steady segment starts at source zero');
}

{
  // A pitch fader move is a handful of segments, not a segment per capture tick,
  // and the segment it settles on carries the new speed.
  const period = 0.02;
  const points = [];
  let position = 0;
  for (let i = 0; i <= 250; i++) {
    position += period;
    points.push({ position, rate: 1 });
  }
  for (let i = 251; i <= 280; i++) {
    const rate = 1 + (0.04 * (i - 250)) / 30;
    position += period * rate;
    points.push({ position, rate });
  }
  for (let i = 281; i <= 750; i++) {
    position += period * 1.04;
    points.push({ position, rate: 1.04 });
  }
  const segs = buildSegments(samples(points, period), { period, endTime: 15 });
  ok(segs.length <= 5, `a pitch move stays a few segments (got ${segs.length})`);
  near(segs[0].speed, 1, 0.002, 'segment before the move keeps 1.0');
  near(segs[segs.length - 1].speed, 1.04, 0.003, 'the last segment follows the fader');
}

{
  // Regression for a real bug: deck positions arrive on the audio render
  // quantum, so a tick-to-tick speed on a steady deck spreads from 0.8 to 1.4 —
  // measured in the browser at 1.05, stdev 0.17. Splitting on that noise turned
  // a five second performance into 37 segments. The declared fader rate is what
  // decides breaks, so untouched decks stay whole no matter how positions wobble.
  const period = 0.02;
  const points = [];
  let position = 0;
  for (let i = 0; i <= 500; i++) {
    position += period * 1.05;
    // Round trip through the quantum, which is where the noise comes from.
    points.push({ position: quantised(position), rate: 1.05 });
  }
  const segs = buildSegments(samples(points, period), { period, endTime: 12 });
  ok(segs.length === 1, `quantised positions stay one segment (got ${segs.length})`);
  near(segs[0].speed, 1.05, 0.002, 'a ten second span recovers the rate from positions');
}

{
  // A short segment cannot recover its rate from quantised endpoints, so it keeps
  // the declared one instead of inventing a speed out of quantisation error.
  const period = 0.02;
  const points = [];
  let position = 0;
  for (let i = 0; i <= 50; i++) {
    position += period * 1.03;
    points.push({ position: quantised(position), rate: 1.03, keyLock: true });
  }
  for (let i = 51; i <= 100; i++) {
    position += period * 1.03;
    points.push({ position: quantised(position), rate: 1.03, keyLock: false });
  }
  const segs = buildSegments(samples(points, period), { period, endTime: 3 });
  ok(segs.length === 2, `a keylock toggle splits a short segment (got ${segs.length})`);
  near(segs[0].speed, 1.03, 0.002, 'a one second segment keeps the declared rate');
}

{
  // Sub-tolerance jitter must not shatter the performance into micro-segments.
  const period = 0.02;
  const points = [];
  let position = 0;
  for (let i = 0; i <= 1000; i++) {
    const wobble = Math.sin(i * 0.7) * SEGMENT_RATE_TOLERANCE * 0.4;
    position += period * (1 + wobble);
    points.push({ position });
  }
  const segs = buildSegments(samples(points, period), { period, endTime: 20 });
  ok(segs.length === 1, `jitter inside tolerance stays one segment (got ${segs.length})`);
}

{
  // A hot cue jump is a seek, and a seek is where a stretched stream must break.
  const period = 0.02;
  const points = [];
  for (let i = 0; i <= 100; i++) points.push({ position: i * period });
  for (let i = 101; i <= 300; i++) points.push({ position: 60 + (i - 101) * period });
  const segs = buildSegments(samples(points, period), { period, endTime: 6 });
  ok(segs.length === 2, `a seek makes two segments (got ${segs.length})`);
  near(segs[1].sourceStart, 60, 0.05, 'the second segment starts at the jump target');
}

{
  const period = 0.02;
  const points = [];
  for (let i = 0; i <= 100; i++) points.push({ position: i * period });
  for (let i = 101; i <= 200; i++) points.push({ position: 2, playing: false });
  for (let i = 201; i <= 300; i++) points.push({ position: 2 + (i - 201) * period });
  const segs = buildSegments(samples(points, period), { period, endTime: 6 });
  ok(segs.length === 2, `a pause splits the timeline (got ${segs.length})`);
  near(segs[0].duration, 2, 0.05, 'the first segment ends when playback stops');
}

{
  const period = 0.02;
  const points = [];
  for (let i = 0; i <= 200; i++) points.push({ position: i * period });
  for (let i = 201; i <= 400; i++) points.push({ position: i * period, trackIndex: 1 });
  const segs = buildSegments(samples(points, period), { period, endTime: 8 });
  ok(segs.length === 2, `loading a track starts a new segment (got ${segs.length})`);
  ok(segs[1].trackIndex === 1, 'the new segment carries the new track');
}

{
  const period = 0.02;
  const points = [];
  for (let i = 0; i <= 100; i++) points.push({ position: i * period });
  for (let i = 101; i <= 200; i++) points.push({ position: i * period, keyShift: 2 });
  const segs = buildSegments(samples(points, period), { period, endTime: 4 });
  ok(segs.length === 2, `a key shift is audible and starts a segment (got ${segs.length})`);
  ok(segs[1].keyShift === 2, 'the new segment carries the key shift');
}

{
  const segs = buildSegments([], { period: 0.02 });
  ok(segs.length === 0, 'an empty recording builds no segments');
}

// ---------------------------------------------------------------- controls

{
  const points = [
    { t: 0, gain: 1, eqLow: 0, eqMid: 0, eqHigh: 0, filter: 0 },
    { t: 1, gain: 1, eqLow: 0, eqMid: 0, eqHigh: 0, filter: 0 },
    { t: 2, gain: 0.5, eqLow: 0, eqMid: 0, eqHigh: 0, filter: 0 },
    { t: 5, gain: 0.5, eqLow: 0, eqMid: 0, eqHigh: 0, filter: 0 },
  ];
  const packed = compressControls(points, deckControlDiffers);
  ok(packed.length === 3, `static control runs collapse (got ${packed.length})`);
  ok(packed[1].gain === 0.5 && packed[2].t === 5, 'the last point is always kept');
}

// ---------------------------------------------------------------- WAV

{
  const frames = 1000;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = Math.sin((i / frames) * Math.PI * 2) * 0.5;
    right[i] = -left[i];
  }
  const blob = encodeWavPlanar([left, right], 44100, { bitDepth: 16 });
  ok(blob.type === 'audio/wav', 'WAV blob has the audio/wav type');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = readWavHeader(bytes);
  ok(header.format === 1, '16-bit WAV is integer PCM');
  ok(header.channels === 2, 'WAV keeps both channels');
  ok(header.sampleRate === 44100, 'WAV keeps the sample rate');
  ok(header.bitDepth === 16, 'WAV keeps the requested depth');
  ok(header.frames === frames, `WAV holds every frame (got ${header.frames})`);
  ok(bytes.length === 44 + frames * 2 * bytesPerSample(16), 'WAV size matches the fmt block');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Stereo frames are interleaved: frame `f`'s two samples are at slots 2f, 2f+1.
  const sampleAt = i => view.getInt16(44 + i * 2, true) / 32767;
  near(sampleAt(250 * 2), left[250], 1 / 32767, 'first channel round-trips');
  near(sampleAt(250 * 2 + 1), right[250], 1 / 32767, 'second channel round-trips');
}

{
  // Overdriven input must clip, not wrap to the opposite polarity.
  const hot = new Float32Array([2, -2, 0]);
  const blob = encodeWavPlanar([hot], 8000, { bitDepth: 16 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  ok(view.getInt16(44, true) === 32767, 'positive overdrive clamps to full scale');
  ok(view.getInt16(46, true) === -32767, 'negative overdrive clamps to full scale');
}

{
  // 24-bit is the default and must be byte-ordered correctly.
  const frames = 8;
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i++) data[i] = i / frames - 0.5;
  const blob = encodeWavPlanar([data], 48000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = readWavHeader(bytes);
  ok(header.bitDepth === 24, 'the default depth is 24-bit');
  const read24 = i => {
    const at = 44 + i * 3;
    let value = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    if (value & 0x800000) value -= 0x1000000;
    return value / 8388607;
  };
  near(read24(4), data[4], 1 / 8388607, '24-bit samples round-trip');
}

// ---------------------------------------------------------------- stretching

/**
 * Interleaved marker track: silence for `leadFrames`, then 5 ms Hann-windowed
 * 1 kHz bursts every 100 ms. Bursts rather than single-sample impulses because a
 * WSOLA overlap crossfade splits a lone impulse across two windows and halves
 * its energy, which makes an impulse train an unreliable position reference.
 */
function bursts(frames, leadFrames) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const length = Math.round(0.005 * SR);
  const spacing = Math.round(0.1 * SR);
  for (let at = leadFrames; at + length < frames; at += spacing) {
    for (let i = 0; i < length; i++) {
      const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
      const value = envelope * Math.sin((2 * Math.PI * 1000 * i) / SR) * 0.9;
      left[at + i] = value;
      right[at + i] = value;
    }
  }
  return { left, right };
}

/**
 * Start frame of each burst, from a block energy envelope with a relative
 * threshold, so a burst that WSOLA attenuated by half is still found.
 */
function burstFrames(data) {
  const win = 128;
  const blocks = Math.floor(data.length / win);
  const envelope = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let energy = 0;
    for (let i = b * win; i < (b + 1) * win; i++) energy += data[i] * data[i];
    envelope[b] = Math.sqrt(energy / win);
  }
  let peak = 0;
  for (const value of envelope) peak = Math.max(peak, value);
  const out = [];
  for (let b = 0; b < blocks; b++) {
    if (envelope[b] < peak * 0.3) continue;
    if (b > 0 && envelope[b - 1] >= envelope[b]) continue;
    if (b + 1 < blocks && envelope[b + 1] > envelope[b]) continue;
    out.push(b * win);
  }
  return out;
}

/**
 * Where each input marker's energy actually landed, relative to the frame the
 * timeline predicts. Searching for energy near the prediction instead of
 * comparing detected marker lists keeps the check readable when WSOLA smears or
 * attenuates a burst, and still fails on a real timing error, because a global
 * or drifting offset shows up as a consistent shift.
 *
 * Markers whose search window falls past the end of the output are counted as
 * held back rather than as errors.
 */
function checkMarkers(label, inputMarks, outputBuffer, outputFrames, tempo, tolFrames) {
  const data = outputBuffer.subarray(0, outputFrames);
  const window = 48;
  const search = Math.round(tolFrames * 2);
  let worst = 0;
  let measured = 0;
  let held = 0;
  for (const at of inputMarks) {
    const expected = Math.round(at / tempo);
    if (expected + search + window > data.length) {
      held++;
      continue;
    }
    let best = 0;
    let bestEnergy = -1;
    for (let delta = -search; delta <= search; delta++) {
      const from = expected + delta;
      if (from < 0 || from + window > data.length) continue;
      let energy = 0;
      for (let i = from; i < from + window; i++) energy += data[i] * data[i];
      if (energy > bestEnergy) {
        bestEnergy = energy;
        best = delta;
      }
    }
    worst = Math.max(worst, Math.abs(best));
    measured++;
  }
  ok(measured > 5, `${label}: enough markers to measure (${measured})`);
  ok(
    worst <= tolFrames,
    `${label}: content lands within ${((tolFrames / SR) * 1000).toFixed(0)} ms of the timeline ` +
      `(worst ${((worst / SR) * 1000).toFixed(1)} ms over ${measured} markers, ${held} held back)`
  );
  return worst;
}

async function stretch(planar, frames, tempo, extraFrames = 0) {
  const capacity = Math.ceil((frames + extraFrames) / tempo) + 4096;
  const outLeft = new Float32Array(capacity);
  const outRight = new Float32Array(capacity);
  const written = await timeStretchTo(
    planarSink(outLeft, outRight, capacity),
    { left: planar.left, right: planar.right, offset: 0, frames },
    SR,
    tempo
  );
  return { left: outLeft, right: outRight, written };
}

{
  // Tempo 1.0 must be as close to identity as WSOLA allows: same length, clicks
  // still where they were. This is also what pins the head latency to zero.
  const frames = SR * 4;
  const source = bursts(frames, Math.round(0.25 * SR));
  const out = await stretch(source, frames, 1.0);
  // WSOLA holds a tail inside the pipeline rather than emitting it, which is
  // exactly why the renderer extends its read window. The estimate must cover
  // the real shortfall or a segment would lose its end.
  const shortfall = frames - out.written;
  ok(shortfall > 0, `the pipeline holds frames back (${shortfall})`);
  ok(
    stretchHoldFrames(SR, 1.0) >= shortfall,
    `the hold estimate covers the real shortfall (${stretchHoldFrames(SR, 1.0)} >= ${shortfall})`
  );
  ok(shortfall < SR * 0.25, `the held tail stays under a quarter second (${shortfall})`);
  ok(out.written < frames, 'the emitted stream is shorter than its input, as WSOLA implies');
  checkMarkers('tempo 1.0', burstFrames(source.left), out.left, out.written, 1.0, SR * 0.02);
}

{
  // Tempo 1.25 must compress the timeline: content lands at input/1.25, and the
  // positions stay correct across the whole segment, not just at the start.
  const frames = SR * 4;
  const source = bursts(frames, Math.round(0.25 * SR));
  const out = await stretch(source, frames, 1.25);
  near(out.written, frames / 1.25, frames / 1.25 * 0.05, 'tempo 1.25 output length');
  // Content must land at input / tempo across the whole segment, not just at the
  // start: that is what makes a rendered mix line up with the timeline.
  checkMarkers('tempo 1.25', burstFrames(source.left), out.left, out.written, 1.25, SR * 0.03);
}

{
  // Keylock: stretching must not move the pitch. This is the property that
  // makes the renderer a keylock rather than a varispeed.
  const frames = SR * 3;
  const tone = new Float32Array(frames);
  for (let i = 0; i < frames; i++) tone[i] = Math.sin((2 * Math.PI * 220 * i) / SR);
  const out = await stretch({ left: tone, right: tone }, frames, 1.5);
  const hz = zeroCrossHz(out.left, out.written);
  near(hz, 220, 3, 'stretching preserves pitch (keylock)');
  near(out.written, frames / 1.5, (frames / 1.5) * 0.06, 'stretching still shortens the timeline');
}

{
  // The documented hold: a stretch run traps frames inside the pipeline, so a
  // segment that stops reading at its own end loses its last ~150 ms. The
  // renderer extends the read window instead, and this is the check that the
  // extension actually rescues content near the segment's end.
  const hold = stretchHoldFrames(SR, 1.25);
  ok(hold > 0, 'the stretcher reports a positive hold');
  const wanted = SR * 2;
  const nearEnd = wanted - Math.round(0.02 * SR);
  const source = bursts(wanted + hold, nearEnd);

  const without = await stretch(source, wanted, 1.25);
  const withHold = await stretch(source, wanted + hold, 1.25);
  const expected = nearEnd / 1.25;
  const found = burstFrames(withHold.left).some(at => Math.abs(at - expected) < SR * 0.03);
  ok(found, 'extending the read window keeps the segment tail audible');
  const foundWithout = burstFrames(without.left).some(at => Math.abs(at - expected) < SR * 0.03);
  ok(
    !foundWithout,
    'without the extension the segment tail is genuinely lost, which is why it is extended'
  );
  ok(
    withHold.written - without.written > SR * 0.05,
    `the extension adds real audio, not padding (${withHold.written - without.written} frames)`
  );
}

{
  // Pitch shift: +12 semitones, same length, double frequency.
  const frames = SR * 2;
  const tone = new Float32Array(frames);
  for (let i = 0; i < frames; i++) tone[i] = Math.sin((2 * Math.PI * 220 * i) / SR);
  const outLeft = new Float32Array(frames + 2048);
  const outRight = new Float32Array(frames + 2048);
  const written = await pitchShiftTo(
    planarSink(outLeft, outRight, outLeft.length),
    { left: tone, right: tone, offset: 0, frames },
    SR,
    12
  );
  near(written, frames, frames * 0.08, 'a pitch shift preserves length');
  near(zeroCrossHz(outLeft, written), 440, 6, 'a +12 semitone shift doubles the pitch');
}

/** Dominant frequency by zero-crossing rate. */
function zeroCrossHz(left, frames) {
  const from = Math.floor(frames * 0.3);
  const to = Math.floor(frames * 0.9);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) {
    if ((left[i - 1] < 0 && left[i] >= 0) || (left[i - 1] >= 0 && left[i] < 0)) crossings++;
  }
  return crossings / 2 / ((to - from) / SR);
}

console.log(`mix-render: ${checks} checks passed`);
