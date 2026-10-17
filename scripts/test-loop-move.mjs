import assert from 'node:assert';
import { travelLoop } from '../src/lib/dj/loop-move.ts';

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

const BEAT = 0.5; // 120 BPM
const BAR = 4 * BEAT;
const DURATION = 240;
const loop = (start, end) => ({ start, end });

// ---------------------------------------------------------------------------
// A running loop travels with the jump, keeping its length and its place in the phrase
// ---------------------------------------------------------------------------
{
  const four = loop(8 * BEAT, 12 * BEAT);

  // Pressed at the loop's first beat, the loop's window simply steps one step along.
  const forward = travelLoop(four, four.start, 12 * BEAT - 8 * BEAT, DURATION);
  near(forward.start, 12 * BEAT, 1e-9, 'the window starts one step on');
  near(forward.end, 16 * BEAT, 1e-9, 'and ends one step on');
  near(forward.end - forward.start, four.end - four.start, 1e-9, 'keeping its length');
  near(forward.playhead, 12 * BEAT, 1e-9, 'the playhead lands on the new first beat');

  // The important case: the loop is *running*, so the playhead is mid-loop, not on a beat.
  // It must keep that offset — landing on the loop's start instead would silently drop the
  // part of the window before the playhead and knock the window off the grid.
  const midLoop = travelLoop(four, 10 * BEAT, BEAT, DURATION);
  near(midLoop.start, 9 * BEAT, 1e-9, 'mid-loop press moves the window by the step');
  near(midLoop.end - midLoop.start, four.end - four.start, 1e-9, 'mid-loop press keeps the length');
  near(midLoop.playhead - midLoop.start, 10 * BEAT - four.start, 1e-9,
    'the playhead keeps exactly its offset inside the loop');
  near(midLoop.playhead, 11 * BEAT, 1e-9, 'the playhead moved by the same step');
}

// ---------------------------------------------------------------------------
// Backwards is the same rule mirrored
// ---------------------------------------------------------------------------
{
  const four = loop(16 * BEAT, 20 * BEAT);
  const back = travelLoop(four, 16 * BEAT, -BAR, DURATION);
  near(back.start, 12 * BEAT, 1e-9, 'the previous window starts a bar back');
  near(back.end, 16 * BEAT, 1e-9, 'and ends where this one starts');
  near(back.playhead, 12 * BEAT, 1e-9, 'the playhead comes back with it');
}

// ---------------------------------------------------------------------------
// The step is whatever the transport asks for, not the loop's own length
// ---------------------------------------------------------------------------
{
  // A two-beat loop with an eight-beat jump step: MOVE is the playhead's step, and the loop
  // follows the playhead. The old rule moved the loop by its own length, which is a different
  // control wearing the same arrows.
  const two = loop(8 * BEAT, 10 * BEAT);
  const eightBeatStep = travelLoop(two, 8 * BEAT, 4 * BAR, DURATION);
  near(eightBeatStep.start, 8 * BEAT + 4 * BAR, 1e-9, 'the window steps by the jump size');
  near(eightBeatStep.end - eightBeatStep.start, two.end - two.start, 1e-9,
    'and still keeps its own length');

  // 174 BPM bar, off a beat: nothing here derives a bar, so the tempo never enters.
  const bar174 = 1.379;
  const at174 = loop(3, 3 + bar174);
  const stepped = travelLoop(at174, 3, bar174, DURATION);
  near(stepped.start, 3 + bar174, 1e-9, 'the shift is exactly the step');
}

// ---------------------------------------------------------------------------
// An off-grid loop is not squared up to anything: it moves, and stays as off-grid as it was
// ---------------------------------------------------------------------------
{
  // Armed with a beat snap rather than a bar snap, so it starts one beat into a bar.
  const offBeat = loop(2 + BEAT, 2 + BEAT + BAR);
  const playhead = offBeat.start + BAR / 2;
  const forward = travelLoop(offBeat, playhead, BEAT, DURATION);

  near(forward.start - offBeat.start, BEAT, 1e-9, 'the window moves exactly the step');
  near(forward.start, offBeat.start + BEAT, 1e-9, 'no snap pulled it onto a beat');
  // The playhead is halfway through the window; a snapped rewrite would have to choose between
  // moving the loop and moving the playhead, and the phase inside the loop would drift.
  near(forward.playhead - forward.start, BAR / 2, 1e-9, 'the offset is untouched');
}

// ---------------------------------------------------------------------------
// The ends of the track clamp the travel instead of dropping the loop
// ---------------------------------------------------------------------------
{
  const first = loop(0, BAR);
  const back = travelLoop(first, 0, -BAR, DURATION);
  ok(back === null, 'a loop pressed against the start has nowhere to come back to');

  const second = loop(BAR, 2 * BAR);
  const backFromSecond = travelLoop(second, BAR, -3 * BAR, DURATION);
  near(backFromSecond.start, 0, 1e-9, 'a long jump back lands against the start');
  near(backFromSecond.end - backFromSecond.start, BAR, 1e-9, 'still holding its length');
  near(backFromSecond.playhead, 0, 1e-9, 'and the playhead with it');

  const last = loop(DURATION - BAR, DURATION);
  ok(travelLoop(last, DURATION - BAR, BAR, DURATION) === null,
    'a loop ending on the last sample cannot travel forward');

  const beforeLast = loop(DURATION - 2 * BAR, DURATION - BAR);
  const forward = travelLoop(beforeLast, DURATION - 2 * BAR, 10 * BAR, DURATION);
  near(forward.end, DURATION, 1e-9, 'a long jump forward stops at the end of the track');
  near(forward.start, DURATION - BAR, 1e-9, 'with the loop still whole');
}

// ---------------------------------------------------------------------------
// Repeated presses walk the track in whole steps and reverse cleanly
// ---------------------------------------------------------------------------
{
  let current = loop(8 * BEAT, 12 * BEAT);
  let playhead = 9 * BEAT;
  const step = BAR;

  for (let i = 1; i <= 6; i++) {
    const next = travelLoop(current, playhead, step, DURATION);
    ok(next !== null, `press ${i} has somewhere to go`);
    near(next.start - current.start, step, 1e-9, `press ${i} advances one step`);
    near(next.end - next.start, current.end - current.start, 1e-9, `press ${i} keeps the length`);
    near(next.playhead - playhead, step, 1e-9, `press ${i} moves the playhead the same distance`);
    current = { start: next.start, end: next.end };
    playhead = next.playhead;
  }
  near(current.start, 8 * BEAT + 6 * BAR, 1e-9, 'six presses advance six steps');
  near(playhead - current.start, BEAT, 1e-9, 'the offset inside the loop never drifted');

  for (let i = 1; i <= 6; i++) {
    const next = travelLoop(current, playhead, -step, DURATION);
    ok(next !== null, `back press ${i} reverses`);
    near(next.start - current.start, -step, 1e-9, `back press ${i} is the same size`);
    current = { start: next.start, end: next.end };
    playhead = next.playhead;
  }
  near(current.start, 8 * BEAT, 1e-9, 'six back presses return to where the walk began');
  near(playhead - current.start, BEAT, 1e-9, 'and so does the playhead');
}

// ---------------------------------------------------------------------------
// Nothing armed (or nothing usable armed) means nothing to travel
// ---------------------------------------------------------------------------
{
  ok(travelLoop(null, 10, BAR, DURATION) === null, 'no loop, no travel');
  ok(travelLoop(undefined, 10, BAR, DURATION) === null, 'undefined is the same as null');
  ok(travelLoop(loop(5, 5), 5, BAR, DURATION) === null, 'a zero-length loop cannot travel');
  ok(travelLoop(loop(5, 4), 5, BAR, DURATION) === null, 'and neither can an inverted one');
  ok(travelLoop(loop(0, DURATION + 10), 10, BAR, DURATION) === null,
    'a loop longer than the track has nowhere to go');
  ok(travelLoop(loop(8, 12), 10, 0, DURATION) === null, 'a zero step is not a move');
}

console.log(`test-loop-move: ${checks} checks passed`);
