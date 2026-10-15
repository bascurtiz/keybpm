import { positiveMod } from './dsp.ts'
import { ODF_HOP, ODF_WIN, frameToSeconds, secondsToFrame } from './spectral-flux.ts'
import type { OnsetEnvelope } from './spectral-flux.ts'
import type { BarStructureAnalysis, DropRecord, PhraseRecord } from './types.ts'

/**
 * Downbeats, bars, drops and phrases.
 *
 * The analyzer already answers "how fast is this and where are the beats". This
 * module answers "*which* beat is the one" — the bar.
 *
 * That question used to be answered by an assumption: bar 1 is the first kick in
 * the intro. The assumption is usually right and audibly wrong when it is not: a
 * track whose intro starts on the 4th beat of a bar keeps every beat in the right
 * place and puts every bar line one beat out, so its drops land on beats 4, 8 and
 * 12 of the bar instead of on 1, 5 and 9. MixCN scores all four bar rotations;
 * Mixxx has no downbeat field at all (its `firstBeat` is exactly the assumption
 * above). So the four rotations are scored here, explicitly, and the losing scores
 * are kept as evidence — the same provenance rule the tempo committee follows.
 *
 * Three cues, in order of how much they can be trusted:
 *
 *  1. **Bass under the beat** — the low-band energy the beat leaves behind, after
 *     the kick has decayed. A sustained bass note is what marks a downbeat in
 *     dance music, and it is the only cue that survives a sparse kick pattern.
 *  2. **Kick/bass attack contrast** — the low-band onset energy at one rotation's
 *     beats versus the others. This is what catches a kick pattern that only
 *     lands on the 1.
 *  3. **Backbeat** — a snare/clap pair on an even subdivision, which *rules out*
 *     half the rotations. It cannot decide on its own: a snare on 2 and 4 is
 *     equally consistent with the bar starting on either side of the pair, so it
 *     narrows the candidates and the choice inside them stays undecided. Saying
 *     nothing is better than guessing wrong about a downbeat, because a wrong bar
 *     line is a mix that misses.
 *
 * When no cue is decisive the anchor is kept (rotation 0) and `rotationDecided`
 * is false. Every caller can then choose to trust it or not, and the benchmark
 * gates both directions: a decision that is wrong, and a decision that was not
 * made where the audio had one to make.
 *
 * The same pass produces **drops** — the bar where the energy steps back up, i.e.
 * the end of an intro or a breakdown — and groups bars into **phrases** from them.
 */

export interface BarStructureInput {
  /** Onset envelope of the analysed window (background-suppressed). */
  env: OnsetEnvelope
  /** The decimated mono the envelope was built from, for per-beat low-band energy. */
  mono: Float32Array
  /** Sample rate of `mono` (the decimated rate), matching `env.envRate`. */
  sampleRate: number
  /** Time in seconds of envelope frame 0 — the window's start in the track. */
  windowStartSec: number
  /** The agreed tempo. */
  bpm: number
  /** Beats per bar (4 for essentially all dance music). */
  beatsPerBar: number
  /** Time of the grid's first audible beat: the lattice's pre-rotation bar anchor. */
  anchorSec: number
  /** End of the analysed window in track time; defaults to the envelope's end. */
  endSec?: number
}

export interface BarStructureResult {
  analysis: BarStructureAnalysis
  /** Bar 1 after rotation scoring: `anchorSec + rotation * beat`. */
  firstBar: number
  /** Absolute downbeat times over the scored span. */
  downbeats: number[]
  /** Absolute drop times; mirrors `analysis.drops`. */
  drops: number[]
}

/** Half-width of the window each beat's onset energy is read from. */
const BEAT_WINDOW_SECONDS = 0.035
/**
 * Cutoff of the one-pole low pass that produces the "bass energy" signal.
 *
 * A one-pole low pass rather than a proper filter on purpose: what the bass cue
 * needs is "is there still low-frequency energy at the end of this beat", and at
 * this cutoff a kick is gone while any held bass note is still there. The exact
 * roll-off shape does not matter to a ratio between two beats.
 */
const BASS_LOWPASS_HZ = 200
/** Where in the beat the "tail" starts: past a kick's decay, inside a bass note. */
const BEAT_TAIL_FROM = 0.55
/** Winner over runner-up a bass cue needs before it is allowed to decide. */
const BASS_UNIQUE = 1.3
/** The winning tail must be at least this much of the loudest beat's low energy. */
const BASS_FLOOR = 0.2
/** Winner over runner-up a kick/bass attack cue needs. */
const ATTACK_UNIQUE = 1.22
/** How flat the low-band profile must be before the backbeat cue is trusted. */
const FLAT_TOLERANCE = 1.25
/** How clearly the snare pair must beat the other positions to narrow anything. */
const BACKBEAT_UNIQUE = 1.3
/** Energy multiple a drop needs over the bars before it. */
const DROP_LIFT = 1.7
/** Fraction of a bar's beats that must carry a kick for a bar to count as rhythmic. */
const KICK_PRESENCE = 0.6
/** Beats with at least this share of the loudest kick count as kick-carrying. */
const KICK_BEAT_SHARE = 0.3
/** Two drops closer together than this are one drop. */
const DROP_MIN_BAR_GAP = 4
const MAX_DROPS = 6
/** Phrase lengths a drop spacing may imply. Dance music is built in fours. */
const PHRASE_CANDIDATES = [4, 8, 16, 32]
/** Phrase length assumed when nothing measured one. */
const DEFAULT_PHRASE_BARS = 8

export function analyzeBarStructure(input: BarStructureInput): BarStructureResult {
  const bpb = Math.max(2, Math.round(input.beatsPerBar) || 4)
  const beatLen = 60 / input.bpm
  const { env, mono, sampleRate } = input
  const spanStart = Math.max(input.windowStartSec, 0)
  const envEnd = frameToSeconds(env.frames - 1, sampleRate, ODF_HOP, ODF_WIN, input.windowStartSec)
  const spanEnd = Math.min(input.endSec ?? envEnd, envEnd)

  // Beats whose whole span lies inside the analysed window: a beat that only
  // half exists cannot be scored or counted as a bar start.
  const firstIndex = Math.ceil((spanStart - input.anchorSec) / beatLen - 1e-9)
  const lastIndex = Math.floor((spanEnd - beatLen - input.anchorSec) / beatLen + 1e-9)

  const features: BeatFeature[] = []
  if (lastIndex >= firstIndex && sampleRate > 0) {
    const bass = lowPass(mono, sampleRate)
    for (let k = firstIndex; k <= lastIndex; k++) {
      features.push(readBeat(input, k, beatLen, bass))
    }
  }

  const rotation = features.length >= 2 * bpb ? scoreRotations(features, bpb) : emptyRotation(bpb)
  const firstBar = Math.max(0, input.anchorSec + rotation.rotation * beatLen)

  const bars = readBars(input, firstBar, beatLen, bpb, spanStart, spanEnd, features)
  const drops = detectDrops(input, bars, features, firstBar, spanStart)
  const downbeats = bars.map(bar => bar.start)
  const phrases = groupPhrases(bars, downbeats, drops, firstBar, beatLen * bpb)
  const phraseBars = phrases.length > 0 ? phrases[0].phraseBars : null

  const maxStrength = drops.reduce((best, drop) => Math.max(best, drop.strength), 0)
  const analysis: BarStructureAnalysis = {
    rotation: rotation.rotation,
    rotationScores: rotation.scores,
    rotationDecision: rotation.decision,
    rotationDecided: rotation.decided,
    rotationCandidates: rotation.candidates,
    phraseBars,
    phraseSource: drops.length === 0 ? 'default' : 'drops',
    bars: bars.length,
    span: [spanStart, spanEnd],
    drops,
    phrases: phrases.map(phrase => phrase.record),
    // Uncalibrated, like every other confidence in the analyzer: a decisive
    // rotation and a clearly-measured drop are the two things this pass knows.
    confidence:
      Math.round(
        (0.6 * (rotation.decided ? 1 : 0.3) + 0.4 * (drops.length > 0 ? Math.min(1, maxStrength / 4) : 0.3)) * 100
      ) / 100,
  }

  return { analysis, firstBar, downbeats, drops: drops.map(drop => drop.time) }
}

// ---------------------------------------------------------------------------
// Rotation scoring
// ---------------------------------------------------------------------------

interface BeatFeature {
  /** Beat index relative to the anchor (0 = the first audible beat). */
  index: number
  time: number
  /** Peak low-band (< 180 Hz) onset flux around the beat. */
  low: number
  /** Peak non-low onset flux around the beat — the snare/clap/hat group. */
  perc: number
  /** Low-band energy over the beat's tail, where a kick has already decayed. */
  tail: number
  /** Low-band energy over the whole beat. */
  whole: number
}

interface RotationVerdict {
  rotation: number
  decided: boolean
  candidates: number[]
  scores: number[]
  decision: string
}

function emptyRotation(bpb: number): RotationVerdict {
  return {
    rotation: 0,
    decided: false,
    candidates: Array.from({ length: bpb }, (_, i) => i),
    scores: [],
    decision: 'too few beats in the analysed window to score the bar',
  }
}

function lowPass(x: Float32Array, sampleRate: number): Float32Array {
  const out = new Float32Array(x.length)
  const a = 1 - Math.exp((-2 * Math.PI * BASS_LOWPASS_HZ) / sampleRate)
  let y = 0
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y)
    out[i] = y
  }
  return out
}

function rms(x: Float32Array, from: number, to: number): number {
  const start = Math.max(0, from)
  const end = Math.min(x.length, to)
  if (end <= start) return 0
  let sum = 0
  for (let i = start; i < end; i++) sum += x[i] * x[i]
  return Math.sqrt(sum / (end - start))
}

function readBeat(input: BarStructureInput, index: number, beatLen: number, bass: Float32Array): BeatFeature {
  const { env, sampleRate } = input
  const time = input.anchorSec + index * beatLen
  const frame = Math.round(secondsToFrame(time, sampleRate, ODF_HOP, ODF_WIN, input.windowStartSec))
  const half = Math.max(1, Math.round(env.envRate * BEAT_WINDOW_SECONDS))
  let low = 0
  let perc = 0
  for (let f = frame - half; f <= frame + half; f++) {
    if (f < 0 || f >= env.frames) continue
    if (env.lowOdf[f] > low) low = env.lowOdf[f]
    const p = env.odf[f] - env.lowOdf[f]
    if (p > perc) perc = p
  }
  const at = (time: number) => Math.round((time - input.windowStartSec) * sampleRate)
  const whole = rms(bass, at(time), at(time + beatLen))
  const tail = rms(bass, at(time + beatLen * BEAT_TAIL_FROM), at(time + beatLen))
  return { index, time, low, perc, tail, whole }
}

/** Mean of a feature over the beats in each rotation group, in bar order. */
function profile(features: BeatFeature[], bpb: number, pick: (feature: BeatFeature) => number): number[] {
  const sums = new Array<number>(bpb).fill(0)
  const counts = new Array<number>(bpb).fill(0)
  for (const feature of features) {
    const group = positiveMod(feature.index, bpb)
    sums[group] += pick(feature)
    counts[group]++
  }
  return sums.map((sum, group) => (counts[group] > 0 ? sum / counts[group] : 0))
}

/**
 * Index of the one clear largest value, or -1 when there is no clear winner: when
 * the runner-up is inside `unique` of it, or when the largest value is not a
 * value at all (all zero). Every cue goes through this, so "no decision" is the
 * same rule everywhere instead of a different threshold per cue.
 */
function decisiveMax(values: number[], unique: number): number {
  if (values.length === 0) return -1
  let best = 0
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i
  const top = values[best]
  if (!(top > 0)) return -1
  let second = 0
  for (let i = 0; i < values.length; i++) if (i !== best && values[i] > second) second = values[i]
  if (second > 0 && top < unique * second) return -1
  return best
}

function normalise(values: number[]): number[] {
  const max = values.reduce((best, value) => Math.max(best, value), 0)
  if (!(max > 0)) return values.map(() => 0)
  return values.map(value => Math.round((value / max) * 1000) / 1000)
}

function ratio(a: number, b: number): string {
  if (!(b > 0)) return 'x∞'
  return `x${(a / b).toFixed(2)}`
}

function scoreRotations(features: BeatFeature[], bpb: number): RotationVerdict {
  const tail = profile(features, bpb, feature => feature.tail)
  const whole = profile(features, bpb, feature => feature.whole)
  const low = profile(features, bpb, feature => feature.low)
  const perc = profile(features, bpb, feature => feature.perc)

  const bassRotation = decisiveMax(tail, BASS_UNIQUE)
  const bassFloor = Math.max(...whole) * BASS_FLOOR
  const bass = bassRotation >= 0 && tail[bassRotation] >= bassFloor ? bassRotation : -1

  const attack = decisiveMax(low, ATTACK_UNIQUE)

  const lowFlat = low.every(value => value > 0) && Math.max(...low) <= FLAT_TOLERANCE * Math.min(...low)
  const backbeat = backbeatCandidates(perc, low, bpb)

  if (bass >= 0) {
    const runnerUp = tail
      .filter((_, index) => index !== bass)
      .reduce((best, value) => Math.max(best, value), 0)
    const agreed = attack === bass
    const detail = `${ratio(tail[bass], Math.max(runnerUp, 1e-9))} the next beat`
    if (agreed) {
      return {
        rotation: bass,
        decided: true,
        candidates: [bass],
        scores: normalise(tail),
        decision: `bass note under beat ${bass + 1} of the bar (tail energy ${detail}), agreeing with the kick/bass attack contrast`,
      }
    }
    return {
      rotation: bass,
      decided: true,
      candidates: [bass],
      scores: normalise(tail),
      decision:
        `bass note under beat ${bass + 1} of the bar (tail energy ${detail})` +
        (attack >= 0 && attack !== bass
          ? `; the kick attack contrast prefers beat ${attack + 1}, which a held bass note outweighs`
          : ''),
    }
  }

  if (attack >= 0) {
    const runnerUp = low
      .filter((_, index) => index !== attack)
      .reduce((best, value) => Math.max(best, value), 0)
    return {
      rotation: attack,
      decided: true,
      candidates: [attack],
      scores: normalise(low),
      decision: `the kick/bass attack lands on beat ${attack + 1} of the bar (low-band onset ${ratio(
        low[attack],
        Math.max(runnerUp, 1e-9)
      )} the next beat)`,
    }
  }

  // Nothing decided. The backbeat cue, if it fired, still narrows the candidates
  // and that narrowing is reported — but it does not move the bar. For 4/4 a
  // snare pair fits two rotations, and the pair is the same whether the bar is
  // read one way or the other, so "the first of the two" would be a coin flip
  // dressed up as a measurement. An undecided bar keeps the anchor and says so.
  const candidates = backbeat ?? Array.from({ length: bpb }, (_, i) => i)
  return {
    rotation: 0,
    decided: false,
    candidates,
    scores: normalise(backbeat ? perc : low),
    decision: backbeat
      ? `a snare pair on beats ${backbeat[0] + 1} and ${positiveMod(backbeat[0] + 2, bpb) + 1} leaves ${
          backbeat.length
        } of ${bpb} rotations open and nothing breaks the tie, so the first audible beat is kept as bar 1`
      : lowFlat
        ? `the low band is even across the bar (four-on-the-floor kick, no bass note) and no snare pair stands out, so the first audible beat is kept as bar 1`
        : `no kick, bass or snare pattern marks the downbeat, so the first audible beat is kept as bar 1`,
  }
}

/**
 * Rotations whose (r+1, r+bpb-1) beat pair carries decisively more percussive
 * (non-low) energy than (r, r+bpb/2) — i.e. the rotations a snare-on-2-and-4
 * backbeat is consistent with. Returns null when no pair stands out.
 *
 * This is a *constraint*, not a vote: in 4/4 the snare pair reads the same two
 * beats apart, so the cue can never pick the downbeat by itself. It is still worth
 * computing, because it rules out the rotations a track's intro demonstrably does
 * not start on — the candidate list is what an undecided bar reports.
 */
function backbeatCandidates(perc: number[], low: number[], bpb: number): number[] | null {
  const flat = low.every(value => value > 0) && Math.max(...low) <= FLAT_TOLERANCE * Math.min(...low)
  if (!flat) return null
  const half = Math.floor(bpb / 2)
  const scores: number[] = []
  for (let r = 0; r < bpb; r++) {
    const onPair = (perc[positiveMod(r + 1, bpb)] + perc[positiveMod(r + bpb - 1, bpb)]) / 2
    const offPair = (perc[r] + perc[positiveMod(r + half, bpb)]) / 2
    scores.push(onPair - offPair)
  }
  const best = decisiveMax(scores, BACKBEAT_UNIQUE)
  if (best < 0) return null
  // The pair readings are the same one half bar apart, so both are candidates.
  return [...new Set([best, positiveMod(best + half, bpb)])].sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

interface BarFeature {
  bar: number
  start: number
  end: number
  /** Broadband energy of the bar: what "the track comes back" looks like. */
  rms: number
  /** Share of the bar's beats that carry a kick. */
  kick: number
}

function readBars(
  input: BarStructureInput,
  firstBar: number,
  beatLen: number,
  bpb: number,
  spanStart: number,
  spanEnd: number,
  features: BeatFeature[]
): BarFeature[] {
  const barLen = beatLen * bpb
  const { mono, sampleRate } = input
  const maxLow = features.reduce((best, feature) => Math.max(best, feature.low), 0)
  const kickThreshold = maxLow * KICK_BEAT_SHARE
  const lowByIndex = new Map<number, number>()
  for (const feature of features) lowByIndex.set(feature.index, feature.low)
  const at = (time: number) => Math.round((time - input.windowStartSec) * sampleRate)

  // Bars are numbered from `firstBar` (bar 0 is the track's bar 1) even when the
  // analysed window starts later than it, so a drop's `bar` means the same thing
  // wherever the window happened to land. Only bars that lie inside the window
  // are scored.
  const bars: BarFeature[] = []
  for (let bar = Math.max(0, Math.ceil((spanStart - firstBar) / barLen)); bar <= 4096; bar++) {
    const start = firstBar + bar * barLen
    if (start + barLen > spanEnd) break
    let kicks = 0
    const firstBeatIndex = Math.round((start - input.anchorSec) / beatLen)
    for (let beat = 0; beat < bpb; beat++) {
      const lowFlux = lowByIndex.get(firstBeatIndex + beat)
      if (lowFlux !== undefined && maxLow > 0 && lowFlux >= kickThreshold) kicks++
    }
    bars.push({
      bar,
      start,
      end: start + barLen,
      rms: rms(mono, at(start), at(start + barLen)),
      kick: kicks / bpb,
    })
  }
  return bars
}

/**
 * Bar-aligned section changes.
 *
 * Two things count as a drop: the bar where a non-rhythmic opening turns into a
 * rhythm (an intro — there is audible material before it, otherwise the track
 * merely starts with silence and there is nothing to mark), and a bar where the
 * energy steps up by {@link DROP_LIFT} over the two bars before it and holds (a
 * lift, i.e. the end of a breakdown). Both are snapped to the bar grid, because a
 * marker that is not on a bar line cannot be mixed at.
 */
function detectDrops(
  input: BarStructureInput,
  bars: BarFeature[],
  features: BeatFeature[],
  firstBar: number,
  spanStart: number
): DropRecord[] {
  const found: DropRecord[] = []
  const barEnergy = bars.length > 0 ? bars[0].rms : 0
  const beatLen = 60 / input.bpm
  const preambleSeconds = firstBar - spanStart
  // Beats before bar 1 that already carry a kick: if the rhythm is already
  // running, a "the rhythm arrives at bar 1" marker is describing nothing.
  const maxLow = features.reduce((best, feature) => Math.max(best, feature.low), 0)
  const preambleIsRhythmic = features.some(
    feature => feature.time < firstBar - 1e-6 && maxLow > 0 && feature.low >= maxLow * KICK_BEAT_SHARE
  )
  if (
    bars.length > 2 &&
    bars[0].bar === 0 &&
    barEnergy > 0 &&
    !preambleIsRhythmic &&
    bars[0].kick >= KICK_PRESENCE &&
    preambleSeconds > beatLen
  ) {
    const at = (time: number) => Math.round((time - input.windowStartSec) * input.sampleRate)
    // Stop a quarter of a beat short of bar 1: the first bar's own kick attack
    // starts there, and including 5 ms of it turned every track into a "the
    // rhythm arrives" drop at x3 the energy of the 0.5 s of silence before it.
    const preamble = rms(input.mono, at(spanStart), at(firstBar - beatLen * 0.25))
    // A silent opening is not a drop, it is silence.
    if (preamble >= 0.05 * barEnergy && barEnergy >= DROP_LIFT * preamble) {
      found.push({
        time: bars[0].start,
        bar: 0,
        kind: 'intro',
        strength: Math.round((barEnergy / Math.max(preamble, 1e-9)) * 100) / 100,
        reason: `the rhythm arrives at bar 1 (bar energy ${ratio(barEnergy, preamble)} the ${preambleSeconds.toFixed(
          1
        )}s before it)`,
      })
    }
  }

  for (let bar = 2; bar + 1 < bars.length; bar++) {
    const before = (bars[bar - 1].rms + bars[bar - 2].rms) / 2
    const after = (bars[bar].rms + bars[bar + 1].rms) / 2
    if (!(before > 0)) continue
    const strength = after / before
    if (strength < DROP_LIFT) continue
    if (bars[bar].kick < KICK_PRESENCE) continue
    found.push({
      time: bars[bar].start,
      bar,
      kind: 'lift',
      strength: Math.round(strength * 100) / 100,
      reason: `bars ${bar + 1}-${bar + 2} hold ${ratio(after, before)} the energy of the two bars before them (track time ${bars[
        bar
      ].start.toFixed(1)}s)`,
    })
  }

  // Strongest first, at least one phrase-feeling gap apart, then back in time order.
  const ordered = [...found].sort((a, b) => b.strength - a.strength)
  const kept: DropRecord[] = []
  for (const drop of ordered) {
    if (kept.length >= MAX_DROPS) break
    if (kept.some(other => Math.abs(other.bar - drop.bar) < DROP_MIN_BAR_GAP)) continue
    kept.push(drop)
  }
  const intro = found.find(drop => drop.kind === 'intro')
  if (intro && !kept.includes(intro)) kept.push(intro)
  return kept.sort((a, b) => a.time - b.time)
}

// ---------------------------------------------------------------------------
// Phrases
// ---------------------------------------------------------------------------

interface PhraseOutcome {
  record: PhraseRecord
  /** Regular phrase length the section spans imply, once known. */
  phraseBars: number | null
}

/**
 * Sections of bars, plus the regular phrase length the drops imply.
 *
 * The section list is measured — it is the spans between detected drops, on top of
 * a regular phrase grid. The phrase length is inferred from the spacing between
 * drops and only accepted when a single length explains every gap, since "8 bars"
 * claimed from one observed gap would be a guess dressed up as a measurement. With
 * no drops at all, the 8-bar dance-music convention is used instead and
 * `phraseSource` says so — the sections are still 8 bars apart, but nothing here
 * measured that and the field exists so a caller can tell the difference.
 */
function groupPhrases(
  bars: BarFeature[],
  downbeats: number[],
  drops: DropRecord[],
  firstBar: number,
  barLen: number
): PhraseOutcome[] {
  if (bars.length === 0) return []
  const firstScoredBar = bars[0].bar
  const barCount = bars[bars.length - 1].bar + 1
  const inferred = inferPhraseBars(drops.map(drop => drop.bar))
  const phraseBars = inferred ?? (drops.length === 0 ? DEFAULT_PHRASE_BARS : null)
  const timeOfBar = (bar: number) => downbeats[bar - firstScoredBar] ?? firstBar + bar * barLen

  const boundaries = new Set<number>([firstScoredBar, barCount])
  if (phraseBars) {
    const from = Math.ceil(firstScoredBar / phraseBars) * phraseBars
    for (let bar = from; bar < barCount; bar += phraseBars) boundaries.add(bar)
  }
  for (const drop of drops) if (drop.bar > firstScoredBar && drop.bar < barCount) boundaries.add(drop.bar)

  const ordered = [...boundaries].sort((a, b) => a - b)
  const out: PhraseOutcome[] = []
  for (let i = 0; i + 1 < ordered.length; i++) {
    const startBar = ordered[i]
    const barsInPhrase = ordered[i + 1] - startBar
    if (barsInPhrase <= 0) continue
    out.push({
      record: {
        startBar,
        bars: barsInPhrase,
        start: timeOfBar(startBar),
        end: timeOfBar(ordered[i + 1]),
        drop: drops.some(drop => drop.bar === startBar),
      },
      phraseBars,
    })
  }
  return out
}

function inferPhraseBars(dropBars: number[]): number | null {
  if (dropBars.length < 2) return null
  const sorted = [...dropBars].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return null
  for (const candidate of [...PHRASE_CANDIDATES].sort((a, b) => b - a)) {
    if (gaps.every(gap => gap % candidate === 0)) return candidate
  }
  return null
}
