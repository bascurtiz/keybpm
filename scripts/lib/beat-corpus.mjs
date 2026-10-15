/**
 * Synthetic beat-tracking corpus, generated deterministically.
 *
 * These tracks are click-accurate by construction: the annotation *is* the
 * schedule the synthesizer played, so a score here measures the analyzer on
 * controlled material with no annotation ambiguity.
 *
 * That is the point and also the limit. This corpus gates regressions — it can
 * tell you that a change moved the F-measure on a wobbling live-drummer pattern,
 * and it runs in CI with no downloads. It cannot tell you the analyzer's accuracy
 * on real music; only an annotated corpus can (see `--corpus` in
 * scripts/bench-beats.mjs, and the corpus layout in bench/README.md). Do not
 * quote these numbers as an accuracy claim.
 *
 * Every case here exists because the analyzer has failed it or could plausibly:
 *
 *  - steady 4/4 across the dance range (128, 138, 174)
 *  - a bassline-only intro before the kick drops (the Bar-1 anchor)
 *  - hats and claps with almost no low end (the kick-group fallback)
 *  - a drummer who wobbles (the case a rigid lattice gets wrong)
 *  - a track that speeds up (the case a rigid lattice cannot hold)
 *  - humanised jitter, which must *not* be mistaken for drift
 *  - half-time / sparse kicks, which invite an octave error
 */

/** Deterministic PRNG (mulberry32) so a corpus run is reproducible. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Beat times for a schedule given as a start tempo plus optional acceleration. */
function beatTimes({
  bpm,
  seconds,
  startBpm = null,
  endBpm = null,
  jitter = 0,
  seed = 1,
  firstBeat = 0.5,
}) {
  const random = rng(seed)
  const beats = []
  let time = firstBeat
  const from = startBpm ?? bpm
  const to = endBpm ?? bpm
  while (time < seconds) {
    beats.push(time)
    const progress = time / seconds
    const localBpm = from + (to - from) * progress
    const wobble = jitter > 0 ? (random() * 2 - 1) * jitter : 0
    time += (60 / localBpm) * (1 + wobble)
  }
  return beats
}

function addKick(out, sampleRate, at, gain = 0.85) {
  const length = Math.floor(sampleRate * 0.12)
  const start = Math.floor(at * sampleRate)
  if (start < 0) return
  for (let i = 0; i < length; i++) {
    const index = start + i
    if (index >= out.length) break
    const t = i / sampleRate
    const freq = 110 * Math.exp(-18 * t) + 45
    const envelope = Math.exp(-9 * t)
    out[index] += Math.sin(2 * Math.PI * freq * t) * envelope * gain
  }
}

function addSnare(out, sampleRate, at, seed = 7, gain = 0.5) {
  const random = rng(seed + Math.floor(at * 1000))
  const length = Math.floor(sampleRate * 0.18)
  const start = Math.floor(at * sampleRate)
  for (let i = 0; i < length; i++) {
    const index = start + i
    if (index < 0 || index >= out.length) continue
    const t = i / sampleRate
    const envelope = Math.exp(-22 * t)
    out[index] += (random() * 2 - 1) * envelope * gain
  }
}

function addHat(out, sampleRate, at, seed = 11, gain = 0.22) {
  const random = rng(seed + Math.floor(at * 1000))
  const length = Math.floor(sampleRate * 0.04)
  const start = Math.floor(at * sampleRate)
  let previous = 0
  for (let i = 0; i < length; i++) {
    const index = start + i
    if (index < 0 || index >= out.length) continue
    const t = i / sampleRate
    const noise = random() * 2 - 1
    // One-pole difference keeps the burst up around / above 1.5 kHz.
    const high = noise - previous
    previous = noise
    out[index] += high * Math.exp(-60 * t) * gain
  }
}

function addBass(out, sampleRate, at, seconds, hz, gain = 0.3) {
  const length = Math.floor(sampleRate * seconds)
  const start = Math.floor(at * sampleRate)
  for (let i = 0; i < length; i++) {
    const index = start + i
    if (index < 0 || index >= out.length) break
    const t = i / sampleRate
    const envelope = Math.exp(-3.2 * t)
    out[index] += Math.sin(2 * Math.PI * hz * t) * envelope * gain
  }
}

/** Sustained pad, for intros with no rhythmic content. */
function addPad(out, sampleRate, at, seconds, gain = 0.06) {
  const length = Math.floor(sampleRate * seconds)
  const start = Math.floor(at * sampleRate)
  for (let i = 0; i < length; i++) {
    const index = start + i
    if (index < 0 || index >= out.length) break
    const t = i / sampleRate
    const fade = Math.min(1, i / (sampleRate * 1.5), (length - i) / (sampleRate * 1.5))
    out[index] +=
      (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) * 0.7) * gain * fade
  }
}

function makeTrack(sampleRate, seconds) {
  return { sampleRate, length: Math.floor(sampleRate * seconds), data: new Float32Array(Math.floor(sampleRate * seconds)) }
}

function finish(track, gain = 0.9) {
  let peak = 0
  for (let i = 0; i < track.data.length; i++) {
    const v = Math.abs(track.data[i])
    if (v > peak) peak = v
  }
  const scale = peak > 0 ? gain / peak : 1
  const mono = new Float32Array(track.data.length)
  for (let i = 0; i < track.data.length; i++) mono[i] = track.data[i] * scale
  return mono
}

function fourOnTheFloor({ bpm, seconds, sampleRate, kickGain, hats, snare, bassHz, bassOnBeat }) {
  const track = makeTrack(sampleRate, seconds)
  const beats = beatTimes({ bpm, seconds })
  for (let i = 0; i < beats.length; i++) {
    addKick(track.data, sampleRate, beats[i], kickGain)
    if (snare && i % 4 === 1) addSnare(track.data, sampleRate, beats[i])
    if (snare && i % 4 === 3) addSnare(track.data, sampleRate, beats[i])
    if (hats) addHat(track.data, sampleRate, beats[i] + 30 / bpm)
    if (bassOnBeat && bassHz) addBass(track.data, sampleRate, beats[i], 60 / bpm, bassHz)
  }
  return { mono: finish(track), beats }
}

/**
 * The corpus. Each entry: `{ name, sampleRate, mono, beats, notes }`, where
 * `beats` are the exact times the synthesizer played.
 */
export function syntheticCorpus() {
  const sampleRate = 44100
  const cases = []

  // 1. House at 128: the easiest case, and the one the DEFAULT grid shape assumes.
  {
    const { mono, beats } = fourOnTheFloor({
      bpm: 128,
      seconds: 40,
      sampleRate,
      kickGain: 0.9,
      hats: true,
      snare: true,
      bassHz: 55,
      bassOnBeat: true,
    })
    cases.push({ name: 'house-128-steady', sampleRate, mono, beats, notes: '4/4 kick, hats, snare 2+4' })
  }

  // 2. Techno at 138 with offbeat bass: the low band is busy on the offbeat.
  {
    const track = makeTrack(sampleRate, 40)
    const beats = beatTimes({ bpm: 138, seconds: 40 })
    for (const beat of beats) {
      addKick(track.data, sampleRate, beat, 0.8)
      addHat(track.data, sampleRate, beat, 0.18)
      addBass(track.data, sampleRate, beat + 60 / 138 / 2, 60 / 138 / 2, 48, 0.34)
    }
    cases.push({ name: 'techno-138-offbeat-bass', sampleRate, mono: finish(track), beats, notes: 'offbeat sub, rolling hats' })
  }

  // 3. Drum and bass at 174: fast tempo, busy break.
  {
    const track = makeTrack(sampleRate, 36)
    const beats = beatTimes({ bpm: 174, seconds: 36 })
    for (let i = 0; i < beats.length; i++) {
      if (i % 2 === 0) addKick(track.data, sampleRate, beats[i], 0.85)
      if (i % 4 === 2) addSnare(track.data, sampleRate, beats[i], 21)
      addHat(track.data, sampleRate, beats[i] + 60 / 174 / 2, 5, 0.2)
    }
    cases.push({ name: 'dnb-174-break', sampleRate, mono: finish(track), beats, notes: '2-step break at 174' })
  }

  // 4. Wobbling live drums: period jitter, the case a rigid lattice gets wrong.
  {
    const track = makeTrack(sampleRate, 40)
    const beats = beatTimes({ bpm: 96, seconds: 40, jitter: 0.03, seed: 4242 })
    for (let i = 0; i < beats.length; i++) {
      addKick(track.data, sampleRate, beats[i], 0.8)
      if (i % 4 === 2) addSnare(track.data, sampleRate, beats[i], 33, 0.55)
      addHat(track.data, sampleRate, beats[i], 3, 0.14)
    }
    cases.push({ name: 'live-drums-96-wobble', sampleRate, mono: finish(track), beats, notes: 'period jitter +/-3%, live feel' })
  }

  // 5. Accelerating track: 124 -> 128 over 40 s. No single tempo is right.
  {
    const track = makeTrack(sampleRate, 42)
    const beats = beatTimes({ startBpm: 124, endBpm: 128, bpm: 126, seconds: 42 })
    for (const beat of beats) {
      addKick(track.data, sampleRate, beat, 0.85)
      addHat(track.data, sampleRate, beat, 0.16)
      addBass(track.data, sampleRate, beat, 60 / 126, 52, 0.26)
    }
    cases.push({ name: 'rising-tempo-124-128', sampleRate, mono: finish(track), beats, notes: 'linear acceleration over 42 s' })
  }

  // 6. Humanised but steady: 25 ms jitter, constant tempo. Must NOT read as drift.
  {
    const track = makeTrack(sampleRate, 36)
    const beats = beatTimes({ bpm: 122, seconds: 36, jitter: 0.004, seed: 99 })
    for (const beat of beats) {
      addKick(track.data, sampleRate, beat, 0.85)
      addSnare(track.data, sampleRate, beat + 60 / 122 / 2, 17, 0.3)
    }
    cases.push({ name: 'humanised-122-tight', sampleRate, mono: finish(track), beats, notes: 'steady tempo, small human jitter' })
  }

  // 7. Bassline intro, kick drops after 5 s: the Bar-1 anchor case.
  {
    const track = makeTrack(sampleRate, 36)
    const beats = beatTimes({ bpm: 126, seconds: 36, firstBeat: 0 })
    const dropAt = 5
    addPad(track.data, sampleRate, 0, dropAt, 0.5)
    for (const beat of beats) {
      if (beat < dropAt) continue
      addKick(track.data, sampleRate, beat, 0.9)
      addSnare(track.data, sampleRate, beat + 60 / 126 / 2, 23, 0.35)
      addBass(track.data, sampleRate, beat, 60 / 126, 50, 0.3)
    }
    const dropBeat = beats.find(beat => beat >= dropAt)
    const dropped = dropBeat === undefined ? beats : beats.filter(beat => beat >= dropBeat)
    cases.push({
      name: 'pad-intro-kick-drop-126',
      sampleRate,
      mono: finish(track),
      beats: dropped,
      notes: '5 s pad intro, then the kick drops: exercises the Bar-1 anchor',
    })
  }

  // 8. Claps and hats with almost no low end: the kick-group fallback.
  {
    const track = makeTrack(sampleRate, 36)
    const beats = beatTimes({ bpm: 118, seconds: 36 })
    for (let i = 0; i < beats.length; i++) {
      addHat(track.data, sampleRate, beats[i], (i % 3) + 40, 0.5)
      if (i % 2 === 1) addSnare(track.data, sampleRate, beats[i], 47, 0.3)
    }
    cases.push({ name: 'claps-hats-118-no-kick', sampleRate, mono: finish(track), beats, notes: 'no kick at all: low group must fall back to the full band' })
  }

  // 9. Half-time trap at 140: kick on 1 and 3, sub slides, inviting an octave error.
  {
    const track = makeTrack(sampleRate, 36)
    const beats = beatTimes({ bpm: 140, seconds: 36 })
    for (let i = 0; i < beats.length; i++) {
      if (i % 4 === 0) addKick(track.data, sampleRate, beats[i], 0.95)
      if (i % 4 === 2) addSnare(track.data, sampleRate, beats[i], 57, 0.4)
      addHat(track.data, sampleRate, beats[i] + 60 / 140 / 2, 3, 0.5)
    }
    cases.push({ name: 'trap-halftime-140', sampleRate, mono: finish(track), beats, notes: 'sparse kicks at 140' })
  }

  return cases
}
