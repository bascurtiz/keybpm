import assert from 'node:assert';
import { analyzeBarStructure } from '../src/lib/dj/bar-structure.ts';
import { computeOnsetEnvelope, suppressBackground, ODF_HOP } from '../src/lib/dj/spectral-flux.ts';
import {
  beatIndexAt,
  barIndexAt,
  beatGridFromMap,
  buildBeatMapFromTicks,
  isVariableGrid,
  downbeatTimes,
  dropMarkers,
  normalizeGrid,
  phraseBoundaries,
  phraseLengthBars,
  phrasesOf,
  shiftGridBeats,
  scaleGridBeats,
  barTimeAt,
} from '../src/lib/dj/grid.ts';
import { syntheticCorpus } from './lib/beat-corpus.mjs';

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

/**
 * The bar-structure pass over an annotated corpus case, with the tempo and the
 * first audible beat taken from the annotation instead of from the analyzer.
 *
 * That isolates this pass: the tests below are about the bar decision and the
 * section markers, so feeding it a tempo the analyzer would first have to earn
 * keeps a beat-tracking failure from looking like a bar failure. End-to-end
 * behaviour is the benchmark's job (scripts/bench-beats.mjs).
 */
function structureFor(name, { bpm = null, anchorBeat = 0 } = {}) {
  const track = syntheticCorpus().find(caseTrack => caseTrack.name === name);
  if (!track) throw new Error(`no corpus case ${name}`);
  const sampleRate = track.sampleRate;
  const mono = track.mono;
  const env = computeOnsetEnvelope(mono, sampleRate);
  if (!env) throw new Error(`no envelope for ${name}`);
  const half = Math.max(2, Math.round(env.envRate * 0.06));
  suppressBackground(env.odf, half);
  suppressBackground(env.lowOdf, half);
  const tempo = bpm ?? 60 / (track.beats[1] - track.beats[0]);
  return {
    track,
    ...analyzeBarStructure({
      env,
      mono,
      sampleRate,
      windowStartSec: 0,
      bpm: tempo,
      beatsPerBar: 4,
      anchorSec: track.beats[anchorBeat],
      endSec: mono.length / sampleRate,
    }),
  };
}

// ---------------------------------------------------------------------------
// Rotation: decided where the audio states the bar
// ---------------------------------------------------------------------------
{
  // A pickup intro: the first audible beat is the fourth beat of the bar, and the
  // bass stab on the downbeat is what says so.
  const { analysis, firstBar, track } = structureFor('midbar-intro-124');
  ok(analysis.rotationDecided, 'a bass note under the downbeat decides the rotation');
  ok(analysis.rotation === 1, `rotation is 1 beat after the first audible beat, got ${analysis.rotation}`);
  near(firstBar, track.downbeats[0], 0.03, 'the bar starts on the annotated first downbeat');
  ok(/bass note/.test(analysis.rotationDecision), `the decision names its evidence: ${analysis.rotationDecision}`);
  ok(analysis.rotationCandidates.length === 1, 'a decided rotation has one candidate left');
  ok(
    analysis.rotationScores.length === 4 && Math.max(...analysis.rotationScores) === 1,
    'the losing rotations are kept as normalised scores'
  );
  ok(track.downbeats.length > 4 && analysis.bars > 4, 'the case is long enough to be a real test');
}

{
  // A kick pattern that only lands on the 1: the low-band attack contrast decides.
  const { analysis } = structureFor('trap-halftime-140');
  ok(analysis.rotationDecided, 'a kick confined to one beat of the bar decides the rotation');
  ok(analysis.rotation === 0, 'that beat is the first audible beat here');
  ok(/attack/.test(analysis.rotationDecision), `the attack cue names itself: ${analysis.rotationDecision}`);
}

{
  // Pad intro, then the drop on a downbeat (bass stab on the 1): decided, and the
  // intro is a section change the DJ can see.
  const { analysis, firstBar, track, drops } = structureFor('pad-intro-kick-drop-126');
  ok(analysis.rotationDecided && analysis.rotation === 0, 'the drop bar is bar 1');
  near(firstBar, track.downbeats[0], 0.03, 'bar 1 is the annotated drop downbeat');
  ok(drops.length === 1, `one drop expected, got ${drops.length}`);
  ok(analysis.drops[0].kind === 'intro', 'a rhythm arriving after non-rhythmic material is an intro drop');
  ok(analysis.drops[0].bar === 0, 'the drop is bar 1');
  near(analysis.drops[0].time, track.drops[0], 0.05, 'the drop lands on the annotated one');
  ok(analysis.drops[0].strength > 1.7, 'the drop reports how much energy arrived');
  ok(analysis.drops[0].reason.length > 10, 'the drop carries its evidence');
}

{
  // Breakdown then drop: a lift, eight bars in, with the phrase structure read
  // from it.
  const { analysis, track } = structureFor('breakdown-bass-126');
  ok(analysis.rotationDecided && analysis.rotation === 0, 'a bass stab on the 1 survives a breakdown');
  ok(analysis.drops.length === 1, `one lift expected, got ${analysis.drops.length}`);
  ok(analysis.drops[0].kind === 'lift', 'the end of a breakdown is a lift');
  ok(analysis.drops[0].bar === 8, `the drop is bar 9 (index 8), got ${analysis.drops[0].bar}`);
  near(analysis.drops[0].time, track.drops[0], 0.05, 'the lift lands on the annotated drop');
  ok(analysis.phraseSource === 'drops', 'phrases come from the measured drop');
  ok(analysis.phraseBars === null, 'one observed gap does not imply a phrase length');
  const phrases = analysis.phrases;
  ok(phrases.length === 2, `two sections expected, got ${phrases.length}`);
  ok(phrases[0].startBar === 0 && phrases[1].startBar === 8, 'the sections meet at the drop');
  ok(phrases[1].drop && !phrases[0].drop, 'only the drop section is marked as one');
  near(phrases[1].start, track.drops[0], 0.05, 'the section starts at the drop time');
}

// ---------------------------------------------------------------------------
// Rotation: no claim where the audio does not state the bar
// ---------------------------------------------------------------------------
{
  // Four-on-the-floor with no bass note and a snare pair: the low band is even,
  // and a snare pair fits two rotations, so there is nothing to decide.
  const { analysis } = structureFor('house-128-steady');
  ok(!analysis.rotationDecided, 'an even kick with no bass note decides nothing');
  ok(analysis.rotation === 0, 'an undecided rotation keeps the first audible beat');
  ok(analysis.rotationCandidates.length <= 4 && analysis.rotationCandidates.length >= 2, 'candidates are reported');
  ok(/kept as bar 1/.test(analysis.rotationDecision), `the reason says what was done: ${analysis.rotationDecision}`);
}

{
  // Two-step break: kick on 1 and 3 (not on 2 or 4), no bass at all.
  const { analysis } = structureFor('dnb-174-break');
  ok(!analysis.rotationDecided, 'a two-step break states no bar without a bassline');
  ok(analysis.rotation === 0, 'and the anchor is kept');
}

{
  // Offbeat sub over a four-on-the-floor kick: the low band is busy but even.
  const { analysis } = structureFor('techno-138-offbeat-bass');
  ok(!analysis.rotationDecided, 'an offbeat sub is not a downbeat marker');
}

{
  // No kick at all: the low band has nothing to say and the claps only narrow.
  const { analysis } = structureFor('claps-hats-118-no-kick');
  ok(!analysis.rotationDecided, 'claps alone never decide a bar');
}

// ---------------------------------------------------------------------------
// Drops: no false markers
// ---------------------------------------------------------------------------
{
  // Every steady case gets no drop at all. A spurious marker is a mix that goes
  // looking for a change that is not there.
  for (const name of ['house-128-steady', 'techno-138-offbeat-bass', 'dnb-174-break', 'humanised-122-tight']) {
    const { analysis } = structureFor(name);
    ok(analysis.drops.length === 0, `${name} reports no drop, got ${analysis.drops.length}`);
  }
  // Four-on-the-floor with a lead-in of silence is silence, not a drop.
  const { analysis } = structureFor('house-128-steady');
  ok(/no kick, bass or snare|could|kept as bar 1/.test(analysis.rotationDecision), 'decision text present');
  ok(analysis.phraseSource === 'default', 'with no drops the phrase length is the 8-bar prior');
  ok(analysis.phraseBars === 8, 'and it is reported as 8 bars');
}

// ---------------------------------------------------------------------------
// Too little material: an empty answer, not a crash
// ---------------------------------------------------------------------------
{
  const sampleRate = 22050;
  const mono = new Float32Array(sampleRate) // one second
  const env = computeOnsetEnvelope(mono, sampleRate);
  const result = analyzeBarStructure({
    env,
    mono,
    sampleRate,
    windowStartSec: 0,
    bpm: 128,
    beatsPerBar: 4,
    anchorSec: 0.5,
    endSec: 1,
  });
  ok(!result.analysis.rotationDecided, 'one second of audio decides nothing');
  ok(result.analysis.rotation === 0, 'and it keeps the anchor');
  ok(result.downbeats.length === 0, 'no bar is scored');
  ok(result.drops.length === 0, 'and no drop is claimed');
  ok(result.analysis.confidence < 0.5, 'a structure with no evidence is not confident');
}

// ---------------------------------------------------------------------------
// The stored data stays consistent through grid edits
// ---------------------------------------------------------------------------
{
  const span = [0, 20];
  const barStructure = {
    rotation: 2,
    rotationScores: [1, 0.4, 0.2, 0.1],
    rotationDecision: 'test fixture',
    rotationDecided: true,
    rotationCandidates: [2],
    phraseBars: 4,
    phraseSource: 'drops',
    bars: 4,
    span,
    drops: [{ time: 8, bar: 4, kind: 'lift', strength: 2.5, reason: 'test fixture' }],
    phrases: [
      { startBar: 0, bars: 4, start: 0, end: 8, drop: false },
      { startBar: 4, bars: 4, start: 8, end: 16, drop: true },
    ],
    confidence: 0.9,
  };
  const grid = {
    bpm: 120,
    firstBeat: 0,
    firstBar: 0,
    beatsPerBar: 4,
    beats: undefined,
    downbeats: [0, 2, 4, 6, 8],
    drops: [8],
    barStructure,
  };
  ok(downbeatTimes(grid, 0, 5).length === 3, 'derived downbeats cover the requested range');
  ok(dropMarkers(grid).length === 1 && dropMarkers(grid)[0].time === 8, 'drops are readable');
  ok(phraseLengthBars(grid) === 4, 'the phrase length is readable');
  ok(phrasesOf(grid).length === 2, 'phrases are readable');
  // Four-bar phrases at 120 BPM are 8 s apart, so 0 and 16 s are boundaries too.
  const boundaries = phraseBoundaries(grid, 0, 16);
  ok(
    boundaries.length === 3 && boundaries[0] === 0 && boundaries[2] === 16,
    `phrase boundaries every 4 bars over 16s, got [${boundaries.join(', ')}]`
  );

  // A bar shift (the manual "shift bar phase" edit) must move the bar data with
  // the bars, and must not overwrite what the analyzer decided.
  const shifted = shiftGridBeats(grid, 1);
  near(shifted.firstBar, 1, 1e-9, 'the bar anchor moved');
  near(shifted.downbeats[0], 1, 1e-9, 'downbeats moved with it');
  near(shifted.drops[0], 8, 1e-9, 'the drop is an audio fact and stays put');
  ok(shifted.barStructure.drops[0].bar === barIndexAt(shifted, 8), 'its bar index is re-derived');
  ok(shifted.barStructure.rotation === 2, 'the analyzer decision is provenance and is not rewritten');
  near(shifted.barStructure.phrases[1].start, barTimeAt(shifted, 4), 1e-9, 'phrase times follow the bars');
  // The rebuilt list covers the analysed span from the new anchor — the same span,
  // re-derived, which is the point: bar markers that do not move are markers that
  // lie about the grid.
  near(shifted.downbeats[0], shifted.firstBar, 1e-9, 'downbeats start at the new bar 1');
  ok(
    shifted.downbeats[shifted.downbeats.length - 1] <= span[1] + 1e-9 && shifted.downbeats.length >= 2,
    'downbeats stay inside the analysed span'
  );

  // Doubling the grid renumbers beats; the bar data follows the new geometry.
  const doubled = scaleGridBeats(grid, 2);
  ok(doubled.bpm === 240, 'BPM doubled');
  ok(
    doubled.downbeats.length > grid.downbeats.length && doubled.downbeats[0] === 0,
    'a doubled grid has twice as many, finer bars'
  );

  // A grid with no bar data is untouched: every demo track and every manually
  // built grid keeps working without the new fields.
  const plain = { bpm: 128, firstBeat: 0.125, firstBar: 2, beatsPerBar: 4 };
  const normalized = normalizeGrid(plain);
  ok(normalized.downbeats === undefined && normalized.barStructure === undefined, 'no bar data is invented');
  near(normalized.firstBeat, 2 % (60 / 128), 1e-9, 'and the phase invariant still holds');
}

// ---------------------------------------------------------------------------
// A variable-tempo grid keeps its bar data too
// ---------------------------------------------------------------------------
{
  // Drifting ticks: no single tempo fits, so the builder returns a beat map and
  // `beatGridFromMap` adopts it. The drops and the bar decision must survive the
  // re-anchoring that comes with it, which is a path the constant-grid cases do
  // not touch.
  const ticks = [];
  let t = 0;
  let local = 128;
  while (t <= 60) {
    ticks.push(t);
    t += 60 / local;
    local -= 0.06;
  }
  const map = buildBeatMapFromTicks(ticks, 120, 0, 60, { constantToleranceSeconds: 0.02 });
  ok(map !== null && map.map !== null, 'drifting ticks produce a beat map');

  const base = {
    bpm: map.refinedBpm,
    firstBeat: 0,
    firstBar: 0,
    beatsPerBar: 4,
    downbeats: [0, 4, 8, 12, 16],
    drops: [8],
    barStructure: {
      rotation: 0,
      rotationScores: [1, 0.2, 0.1, 0.2],
      rotationDecision: 'test fixture',
      rotationDecided: true,
      rotationCandidates: [0],
      phraseBars: 4,
      phraseSource: 'drops',
      bars: 4,
      span: [0, 20],
      drops: [{ time: 8, bar: 2, kind: 'lift', strength: 3, reason: 'test fixture' }],
      phrases: [
        { startBar: 0, bars: 2, start: 0, end: 8, drop: false },
        { startBar: 2, bars: 2, start: 8, end: 16, drop: true },
      ],
      confidence: 0.9,
    },
  };
  const mapped = beatGridFromMap(base, map.map);
  ok(isVariableGrid(mapped), 'the grid is now variable-tempo');
  ok(mapped.barStructure.rotation === 0, 'the bar decision is provenance and survives');
  ok(mapped.drops.length === 1 && mapped.drops[0] === 8, 'the drop time is unchanged');
  ok(mapped.barStructure.drops[0].bar === barIndexAt(mapped, 8), 'and its bar index follows the new grid');
  ok(
    mapped.downbeats.length > 0 && mapped.downbeats[0] >= 0 && mapped.downbeats[1] > mapped.downbeats[0],
    'downbeats are rebuilt from the beat map'
  );
  near(mapped.barStructure.phrases[1].start, barTimeAt(mapped, 2), 1e-9, 'phrase times follow the map');
  ok(phraseBoundaries(mapped, 0, 20).length >= 2, 'phrase boundaries are readable on a variable grid');
}

console.log(`bar-structure: ${checks} assertions passed`);
