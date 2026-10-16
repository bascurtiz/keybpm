import assert from 'node:assert';
import { barPhaseAt, barTimeAt, beatLengthAt } from '../src/lib/dj/grid.ts';
import { loopMoveDestination } from '../src/lib/dj/loop-move.ts';

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

// Same constant grid the other grid tests use: beats of 60/128 s, bar-1 downbeat at 2.0 s.
const grid = { bpm: 128, firstBeat: 0.125, firstBar: 2, beatsPerBar: 4 };
const beatLen = beatLengthAt(grid, 0);
const barLen = beatLen * 4;
const DURATION = 240;

const loop = (start, end) => ({ start, end });
const at = t => barTimeAt(grid, t);

// ---------------------------------------------------------------------------
// A whole-bar loop travels bar to bar, exactly its own length
// ---------------------------------------------------------------------------
{
  const fourBeats = loop(2, 2 + barLen);

  const forward = loopMoveDestination(fourBeats, grid, 1, DURATION);
  near(forward.start, at(1), 1e-9, 'a bar-aligned loop moves forward one bar');
  near(forward.end - forward.start, barLen, 1e-9, 'and keeps its length');
  near(barPhaseAt(grid, forward.start), 0, 1e-9, 'landing on a downbeat');

  const back = loopMoveDestination(fourBeats, grid, -1, DURATION);
  near(back.start, at(-1), 1e-9, 'and backwards one bar');
  near(barPhaseAt(grid, back.start), 0, 1e-9, 'also on a downbeat');

  // The grid's own first bar line is the floor: nothing exists a bar before it. (The anchor at 2.0 s
  // is bar 0, so bar -1 at 0.125 s still has a destination and bar -1 does not.)
  ok(loopMoveDestination(loop(at(-1), at(-1) + barLen), grid, -1, DURATION) === null,
    'a loop on the first bar line cannot travel back');
  ok(loopMoveDestination(loop(at(0), at(0) + barLen), grid, -1, DURATION) !== null,
    'while the bar after it still can');
}

// ---------------------------------------------------------------------------
// A sub-bar loop moves a whole bar rather than a fraction of one
// ---------------------------------------------------------------------------
{
  const twoBeats = loop(2, 2 + 2 * beatLen);
  const forward = loopMoveDestination(twoBeats, grid, 1, DURATION);
  near(forward.start, at(1), 1e-9, 'a two-beat loop moves to the next bar, not half a bar');
  near(forward.end - forward.start, 2 * beatLen, 1e-9, 'and keeps its two beats');
  ok(forward.start - twoBeats.start >= 2 * beatLen - 1e-9,
    'the move is never shorter than the loop');
}

// ---------------------------------------------------------------------------
// A loop sitting off the grid squares up to a bar line and still travels forward
// ---------------------------------------------------------------------------
{
  // One beat into the bar, one bar long — the awkward case, since the nearest bar line is behind it.
  const offBar = loop(2 + beatLen, 2 + beatLen + barLen);
  const forward = loopMoveDestination(offBar, grid, 1, DURATION);
  ok(forward.start > offBar.start, 'an off-grid loop still moves forwards');
  ok(
    Math.abs(forward.start - (offBar.start + barLen)) > 1e-6,
    'the destination is snapped to a bar line, not the plain shift (a rule without bar snapping fails here)'
  );
  near(barPhaseAt(grid, forward.start), 0, 1e-9, 'and lands on a downbeat');
  ok(forward.start - offBar.start >= barLen - 1e-9,
    'by at least its own length, not by the short hop back to the bar it came from');
}

// ---------------------------------------------------------------------------
// End of track: no destination rather than a loop hanging off the end
// ---------------------------------------------------------------------------
{
  const nearEnd = loop(at(50), at(50) + barLen);
  ok(loopMoveDestination(nearEnd, grid, 1, 240) !== null, 'a bar near the end can still move');
  ok(loopMoveDestination(nearEnd, grid, 1, at(51) + barLen - 1e-3) === null,
    'unless the destination would run past the end of the track');
}

// ---------------------------------------------------------------------------
// Repeated presses advance along the bars without drifting
// ---------------------------------------------------------------------------
{
  let current = loop(2, 2 + barLen);
  const seen = [current.start];
  for (let i = 0; i < 6; i++) {
    const next = loopMoveDestination(current, grid, 1, DURATION);
    ok(next !== null, `press ${i + 1} has somewhere to go`);
    near(barPhaseAt(grid, next.start), 0, 1e-9, `press ${i + 1} lands on a downbeat`);
    near(next.end - next.start, barLen, 1e-9, `press ${i + 1} keeps the length`);
    ok(next.start > current.start, `press ${i + 1} moves forwards`);
    current = next;
    seen.push(current.start);
  }
  near(current.start, at(6), 1e-9, 'six presses from bar 0 land on bar 6');

  let back = loop(at(12), at(12) + barLen);
  for (let i = 0; i < 6; i++) {
    const next = loopMoveDestination(back, grid, -1, DURATION);
    ok(next !== null && next.start < back.start, `back press ${i + 1} reverses`);
    back = next;
  }
  near(back.start, at(6), 1e-9, 'six back presses from bar 12 land on bar 6');
}

// ---------------------------------------------------------------------------
// A drifting grid: the destination is that track's own bar line
// ---------------------------------------------------------------------------
{
  const drift = t => 128 + 7 * Math.sin(t / 25);
  const beats = ticksFromTempo(drift, 200);
  const variable = { bpm: 128, firstBeat: 0, firstBar: 0, beatsPerBar: 4, beats };

  // Bars 8 to 12, taken straight off the measured beat times.
  const start = beats[32];
  const end = beats[48];
  const length = end - start;
  const forward = loopMoveDestination({ start, end }, variable, 1, DURATION);

  ok(forward !== null, 'a drifting track still has somewhere to go');
  near(barPhaseAt(variable, forward.start), 0, 1e-9, 'landing on a measured downbeat');
  ok(forward.start - start >= length - 1e-9, 'at least its own length away');
  ok(
    Math.abs(beats[64] - start) > 0.01,
    'sanity: the drift moved the four-bar span off where a fixed tempo would put it'
  );
  // Where the grid actually is, not where a fixed bar length would put it: bar 16, one bar past the
  // loop's own end, since the reach lands inside bar 15 or 16 depending on which way the tempo went.
  const onGrid = beats.filter((_, i) => i % 4 === 0).some(t => Math.abs(t - forward.start) <= 1e-9);
  ok(onGrid, 'the destination is one of the grid bar lines');

  const back = loopMoveDestination({ start, end }, variable, -1, DURATION);
  const onGridBack = beats.filter((_, i) => i % 4 === 0).some(t => Math.abs(t - back.start) <= 1e-9);
  ok(onGridBack, 'and so is the backwards one');
  ok(start - back.start >= length - 1e-9, 'backwards is at least its own length too');
}

// ---------------------------------------------------------------------------
// A track with no analysed grid gets a constant one at its own tempo
// ---------------------------------------------------------------------------
{
  // What DeckEngine.loopMoveTarget builds for an unanalysed track — 174 BPM bars, not the 120 BPM
  // default a null grid would use.
  const unanalysed = { bpm: 174, firstBeat: 0, firstBar: 0, beatsPerBar: 4 };
  const barLen174 = beatLengthAt(unanalysed, 0) * 4;
  ok(Math.abs(barLen174 - 1.379) < 0.01, 'sanity: a 174 BPM bar is about 1.38 s');

  // On a bar line of that grid (bar 2), one press is exactly one bar — of 174 BPM, not of 120.
  const aligned = 2 * barLen174;
  const forward = loopMoveDestination(loop(aligned, aligned + barLen174), unanalysed, 1, DURATION);
  near(forward.start, 3 * barLen174, 1e-9, 'the move steps a bar at the track\'s own tempo');

  // Off a bar line, it squares up onto one and still travels at least its own length (which takes it
  // two bars here, from 2.17 bars in to the start of bar 4).
  const offBar = loopMoveDestination(loop(3, 3 + barLen174), unanalysed, 1, DURATION);
  near(offBar.start, 4 * barLen174, 1e-9, 'an off-grid loop lands on the next bar line of that grid');
  ok(offBar.start - 3 >= barLen174 - 1e-9, 'and travels at least its own length to get there');
  ok(
    Math.abs(offBar.start - (3 + barLen174)) > 1e-6,
    'again snapped, not shifted'
  );

  const backward = loopMoveDestination(loop(0.5, 0.5 + barLen174), unanalysed, -1, DURATION);
  ok(backward === null, 'and cannot move before zero');
}

// ---------------------------------------------------------------------------
// Nothing armed, nothing to move
// ---------------------------------------------------------------------------
{
  ok(loopMoveDestination(null, grid, 1, DURATION) === null, 'no loop, no destination');
  ok(loopMoveDestination(loop(5, 5), grid, 1, DURATION) === null, 'a zero-length loop is refused');
}

console.log(`test-loop-move: ${checks} checks passed`);
