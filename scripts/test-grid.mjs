import assert from 'node:assert';
import {
  beatIndexAt,
  beatLengthAt,
  beatTimeAt,
  barPhaseAt,
  barIndexAt,
  barTimeAt,
  downbeatIndex,
  bpmAt,
  isVariableGrid,
  snapToBeat,
  nextBeatTime,
  nextBarTime,
  shiftBars,
  buildBeatMapFromTicks,
  localBpmStats,
  normalizeGrid,
  collapseGridToConstant,
  shiftGridBeats,
  scaleGridBeats,
  reanchorBar,
  beatGridFromMap,
  localTempoRange,
} from '../src/lib/dj/grid.ts';

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

/** Deterministic PRNG so the jitter tests never flake. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Beat onsets for a track whose tempo follows `bpmAtTime`. */
function ticksFromTempo(bpmAtTime, duration) {
  const ticks = [];
  let t = 0;
  while (t <= duration) {
    ticks.push(t);
    t += 60 / bpmAtTime(t);
  }
  return ticks;
}

// A valid constant grid: firstBeat is the firstBar phase (2 % 0.46875 = 0.125),
// so beat 4 lands exactly on the bar-1 downbeat at 2.0s.
const constantGrid = { bpm: 128, firstBeat: 0.125, firstBar: 2, beatsPerBar: 4 };

// ---------------------------------------------------------------------------
// Constant grid: lookup round trips and phase
// ---------------------------------------------------------------------------
{
  near(beatTimeAt(constantGrid, 0), 0.125, 1e-9, 'beatTimeAt(0) is the lattice root');
  near(beatTimeAt(constantGrid, 4), 2, 1e-9, 'beatTimeAt(4) reaches the bar anchor');
  near(beatIndexAt(constantGrid, 2), 4, 1e-9, 'beatIndexAt is the inverse of beatTimeAt');
  near(beatIndexAt(constantGrid, 0.125 + 3 * (60 / 128)), 3, 1e-9, 'beatIndexAt round trips');
  near(beatLengthAt(constantGrid, 10), 60 / 128, 1e-9, 'beatLengthAt is uniform');

  ok(!isVariableGrid(constantGrid), 'a grid without beats[] is constant');
  ok(!isVariableGrid(null), 'a missing grid is not variable');

  near(barPhaseAt(constantGrid, 2), 0, 1e-9, 'barPhaseAt is 0 on the downbeat');
  near(barPhaseAt(constantGrid, 2 + 2 * (60 / 128)), 0.5, 1e-9, 'barPhaseAt is 0.5 mid-bar');
  near(barPhaseAt(constantGrid, 2 + 4 * (60 / 128)), 0, 1e-9, 'barPhaseAt wraps at the bar line');
  near(barIndexAt(constantGrid, 2), 0, 1e-9, 'barIndexAt is 0 at the anchor');
  near(barIndexAt(constantGrid, 2 + 4 * (60 / 128)), 1, 1e-9, 'barIndexAt advances per bar');
  near(barIndexAt(constantGrid, 2 - 4 * (60 / 128)), -1, 1e-9, 'barIndexAt goes negative before the anchor');
  near(barTimeAt(constantGrid, 2), 2 + 8 * (60 / 128), 1e-9, 'barTimeAt walks forward');
  near(downbeatIndex(constantGrid), 4, 1e-9, 'downbeatIndex is an exact beat index');

  // The invariant the type documents: firstBeat === firstBar (mod beat length).
  const beatLen = 60 / constantGrid.bpm;
  near(
    ((constantGrid.firstBar - constantGrid.firstBeat) % beatLen + beatLen) % beatLen,
    0,
    1e-9,
    'firstBeat is the firstBar phase'
  );

  near(snapToBeat(constantGrid, 2 + beatLen / 2 - 0.001), 2, 1e-9, 'snapToBeat picks the nearest beat');
  near(
    snapToBeat(constantGrid, 2 + beatLen / 2 + 0.001),
    2 + beatLen,
    1e-9,
    'snapToBeat advances past the midpoint'
  );
  near(snapToBeat(constantGrid, 2 + beatLen / 2), 2 + beatLen, 1e-9, 'snapToBeat rounds the midpoint up');
  near(nextBeatTime(constantGrid, 2), 2 + beatLen, 1e-9, 'nextBeatTime skips the current beat');
  near(nextBeatTime(constantGrid, 2.1), 2 + beatLen, 1e-9, 'nextBeatTime finds the next boundary');
  near(nextBeatTime(constantGrid, 2, -1), 2 - beatLen, 1e-9, 'nextBeatTime goes backwards');
  near(nextBarTime(constantGrid, 2 + beatLen), 2 + 4 * beatLen, 1e-9, 'nextBarTime finds the bar line');
  near(nextBarTime(constantGrid, 2, -1), 2 - 4 * beatLen, 1e-9, 'nextBarTime goes back a bar');

  near(
    shiftBars(constantGrid, 2 + 4 * beatLen, 2),
    2 + 12 * beatLen,
    1e-9,
    'shiftBars moves exactly two bars'
  );
  near(
    shiftBars(constantGrid, 2 + 4 * beatLen + 0.4, 2),
    2 + 12 * beatLen + 0.4,
    1e-9,
    'shiftBars keeps the offset inside the bar'
  );
}

// ---------------------------------------------------------------------------
// Analyzer decision: constant tracks must NOT become variable
// ---------------------------------------------------------------------------
{
  const duration = 180;
  const perfect = ticksFromTempo(() => 128, duration);
  const perfectOutcome = buildBeatMapFromTicks(perfect, 128, 0, duration);
  ok(perfectOutcome !== null, 'a clean tick train is measurable');
  ok(perfectOutcome.map === null, 'a perfectly constant track stays a constant grid');
  near(perfectOutcome.refinedBpm, 128, 0.05, 'the refined BPM matches a constant track');

  // Same track, but analysed with a BPM that is 0.15 off. The refinement should
  // absorb the error instead of being mistaken for drift.
  const offBeatOutcome = buildBeatMapFromTicks(perfect, 127.85, 0, duration);
  ok(offBeatOutcome !== null, 'an offset estimate is still measurable');
  ok(offBeatOutcome.map === null, 'a slightly wrong global BPM is not drift');
  near(offBeatOutcome.refinedBpm, 128, 0.05, 'the refinement corrects the estimate');

  // Ordinary detection jitter on a constant track must not flip it to variable.
  const rand = rng(20261015);
  const jittered = perfect.map(t => t + (rand() - 0.5) * 0.03);
  const jitterOutcome = buildBeatMapFromTicks(jittered, 128, 0, duration);
  ok(jitterOutcome !== null, 'a jittery tick train is measurable');
  ok(jitterOutcome.map === null, 'jitter alone does not create a variable grid');

  // Too few ticks to judge.
  ok(buildBeatMapFromTicks([0, 0.469, 0.938], 128, 0, duration) === null, 'sparse ticks are rejected');
  // A zero/NaN tempo must not throw.
  ok(buildBeatMapFromTicks(perfect, 0, 0, duration) === null, 'an invalid BPM is rejected');
}

// ---------------------------------------------------------------------------
// Analyzer decision: drifting tracks become variable
// ---------------------------------------------------------------------------
{
  const duration = 180;
  // 128 -> 126 BPM over three minutes: a live band easing off.
  const drifting = ticksFromTempo(t => 128 - (2 * t) / duration, duration);
  const outcome = buildBeatMapFromTicks(drifting, 127, 0, duration);
  ok(outcome !== null, 'a drifting track is measurable');
  ok(outcome.map !== null, 'a drifting track yields a variable grid');

  // The map becomes a grid the way the analyser will apply it.
  const map = beatGridFromMap(constantGrid, outcome.map);
  ok(map.beats.length >= drifting.length - 2, 'every measured beat is represented');
  ok(isVariableGrid(map), 'the produced grid reports as variable');
  ok(outcome.map.bpmMin < outcome.map.bpm, 'the tempo range spans downward');
  ok(outcome.map.bpmMax > outcome.map.bpm, 'the tempo range spans upward');
  ok(outcome.map.maxDrift > 0.08, `drift is detected (maxDrift ${outcome.map.maxDrift})`);
  near(map.bpm, 127, 1.5, 'the headline BPM is the median local tempo');

  // The grid must actually land on the audio, not merely exist.
  let worst = 0;
  for (const tick of drifting) {
    if (tick < map.beats[0] || tick > map.beats[map.beats.length - 1]) continue;
    const snapped = beatTimeAt(map, Math.round(beatIndexAt(map, tick)));
    worst = Math.max(worst, Math.abs(snapped - tick));
  }
  ok(worst < 0.03, `every measured beat snaps back onto the grid (worst ${(worst * 1000).toFixed(1)}ms)`);

  // The bar anchor lands on a real beat, so bar phase stays exact.
  ok(
    map.beats.some(t => Math.abs(t - map.firstBar) < 1e-9),
    'the bar anchor is moved onto a measured beat'
  );

  // Index/time round trip on the variable grid.
  for (let i = 0; i < map.beats.length; i += 37) {
    near(beatIndexAt(map, map.beats[i]), i, 1e-6, `beatIndexAt inverts beatTimeAt at index ${i}`);
  }
  near(barPhaseAt(map, map.beats[downbeatIndex(map)]), 0, 1e-9, 'barPhaseAt is 0 on the anchor beat');

  // Local tempo must vary across the track.
  near(bpmAt(map, 0), 128, 0.8, 'local tempo at the start matches the start of the drift');
  near(bpmAt(map, duration - 1), 126, 0.8, 'local tempo at the end matches the end of the drift');
  ok(
    beatLengthAt(map, duration - 1) > beatLengthAt(map, 1),
    'beats get longer as the track slows down'
  );

  // Local tempo is windowed, so it must not flicker with per-interval tick jitter.
  let worstStep = 0;
  for (let t = 2; t < 100; t += 0.25) {
    worstStep = Math.max(worstStep, Math.abs(bpmAt(map, t) - bpmAt(map, t + 0.25)));
  }
  ok(worstStep < 0.5, `local tempo is stable between nearby positions (worst ${worstStep.toFixed(3)})`);

  // It must still be local: the reading at the start and end differ.
  ok(Math.abs(bpmAt(map, 2) - bpmAt(map, duration - 2)) > 1.2, 'local tempo still varies across the track');

  // The reported tempo spread must describe the real drift, not tick quantisation.
  const range = localTempoRange(map);
  const raw = localBpmStats(map.beats);
  ok(range !== null, 'a variable grid reports a tempo spread');
  near(range.max, 128, 0.7, 'the spread reaches the start of the drift');
  near(range.min, 126, 0.7, 'the spread reaches the end of the drift');
  // Smoothing must never invent tempo outside the raw measured extremes. On real
  // detector output it is narrower still, because ticks are quantised (measured in
  // the browser: 124.4-127.8 smoothed against 123.0-129.2 raw on the same track).
  ok(
    range.min >= raw.min - 1e-6 && range.max <= raw.max + 1e-6,
    'the smoothed spread stays inside the raw interval extremes'
  );
  ok(
    range.max - range.min <= raw.max - raw.min + 1e-6,
    'the smoothed spread is never wider than the raw one'
  );
  ok(
    localTempoRange(constantGrid).min === constantGrid.bpm,
    'a constant grid reports its own tempo as the spread'
  );
  ok(localTempoRange(null) === null, 'a missing grid has no tempo spread');

  // Extrapolation outside the measured range stays on the boundary tempo.
  const beforeFirst = beatTimeAt(map, -4);
  ok(beforeFirst < map.beats[0], 'extrapolation before the first beat moves earlier');
  near(
    map.beats[0] - beforeFirst,
    4 * (map.beats[1] - map.beats[0]),
    1e-6,
    'extrapolation uses the leading tempo'
  );
  const lastIndex = map.beats.length - 1;
  const afterLast = beatTimeAt(map, lastIndex + 4);
  near(
    afterLast - map.beats[lastIndex],
    4 * (map.beats[lastIndex] - map.beats[lastIndex - 1]),
    1e-6,
    'extrapolation uses the trailing tempo'
  );
  ok(nextBeatTime(map, map.beats[0]) > map.beats[0], 'stepping forward moves forward');
  ok(nextBeatTime(map, map.beats[lastIndex], -1) < map.beats[lastIndex], 'stepping back moves back');
}

// ---------------------------------------------------------------------------
// Analyzer decision: an abrupt tempo change becomes variable
// ---------------------------------------------------------------------------
{
  const duration = 150;
  const stepped = ticksFromTempo(t => (t < 60 ? 128 : 122), duration);
  const outcome = buildBeatMapFromTicks(stepped, 125, 0, duration);
  ok(outcome !== null && outcome.map !== null, 'a tempo step yields a variable grid');
  const map = beatGridFromMap(constantGrid, outcome.map);

  let worst = 0;
  for (const tick of stepped) {
    if (tick < map.beats[0] || tick > map.beats[map.beats.length - 1]) continue;
    const snapped = beatTimeAt(map, Math.round(beatIndexAt(map, tick)));
    worst = Math.max(worst, Math.abs(snapped - tick));
  }
  ok(worst < 0.05, `the grid follows the step (worst ${(worst * 1000).toFixed(1)}ms)`);
  ok(
    bpmAt(map, duration - 1) < bpmAt(map, 5),
    'local tempo drops after the step'
  );
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------
{
  const variable = {
    bpm: 127,
    firstBeat: 0.2,
    firstBar: 2.2,
    beatsPerBar: 4,
    beats: [2.2, 2.67, 3.14, 3.61, 4.08, 4.55],
  };
  ok(isVariableGrid(variable), 'a grid with beats[] is variable');

  const normalized = normalizeGrid({ bpm: 120, firstBeat: 99, firstBar: 2.0, beatsPerBar: 4 });
  near(normalized.firstBeat, 2.0 % 0.5, 1e-9, 'normalizeGrid restores the phase invariant');

  const collapsed = collapseGridToConstant(variable, 126, 2.2);
  ok(!isVariableGrid(collapsed), 'collapseGridToConstant drops the beat map');
  near(collapsed.bpm, 126, 1e-9, 'collapseGridToConstant keeps the new tempo');
  near(collapsed.firstBar, 2.2, 1e-9, 'collapseGridToConstant keeps the anchor');
  near(barPhaseAt(collapsed, 2.2), 0, 1e-9, 'the collapsed grid still has a clean downbeat');

  const shifted = shiftGridBeats(variable, 0.1);
  near(shifted.beats[0], 2.3, 1e-9, 'shiftGridBeats moves the beats');
  near(shifted.firstBar, 2.3, 1e-9, 'shiftGridBeats moves the anchor with them');
  ok(shifted.beats.length === variable.beats.length, 'shiftGridBeats keeps the beat count');

  // Shifting earlier than the first beat must clamp instead of going negative.
  const clamped = shiftGridBeats(variable, -10);
  ok(clamped.beats[0] >= 0, 'shiftGridBeats never leaves a negative beat');
  for (let i = 1; i < clamped.beats.length; i++) {
    ok(clamped.beats[i] > clamped.beats[i - 1], 'the shifted beat map stays strictly increasing');
  }

  const doubled = scaleGridBeats(variable, 2);
  near(doubled.bpm, 254, 0.1, 'doubling the grid doubles the tempo');
  ok(doubled.beats.length > variable.beats.length * 1.8, 'doubling interleaves new beats');
  ok(doubled.beats[0] < variable.beats[0], 'doubling extends the grid before the first beat');
  near(doubled.beats[1], variable.beats[0], 1e-6, 'doubling keeps the original beats on the grid');
  near(doubled.beats[3], variable.beats[1], 1e-6, 'original beats land on even indices after doubling');
  near(
    doubled.beats[2],
    (variable.beats[0] + variable.beats[1]) / 2,
    1e-6,
    'doubling interleaves the interval midpoints'
  );

  const halved = scaleGridBeats(variable, 0.5);
  near(halved.bpm, 63.5, 0.1, 'halving the grid halves the tempo');
  ok(halved.beats.length <= Math.ceil(variable.beats.length / 2) + 1, 'halving drops every other beat');
  near(halved.beats[0], variable.beats[0], 1e-9, 'halving keeps the first beat');

  const snappedAnchor = reanchorBar({ ...variable, firstBar: 2.4 });
  ok(
    variable.beats.some(t => Math.abs(t - snappedAnchor.firstBar) < 1e-9),
    'reanchorBar puts the anchor back onto a real beat'
  );

  const stats = localBpmStats([0, 0.5, 1.0, 1.6]);
  ok(stats !== null && stats.min > 0, 'localBpmStats reports a tempo range');
  ok(localBpmStats([]) === null, 'localBpmStats handles an empty list');
}

console.log(`grid tests passed (${checks} assertions)`);
