#!/usr/bin/env node
/**
 * Beat-grid accuracy benchmark.
 *
 * Scores what a DJ actually gets — the **stored grid**, read back through the
 * same accessors the deck uses — against known beat times, with the metrics in
 * src/lib/dj/beat-metrics.ts (F-measure at 70 ms, continuity, grid drift).
 *
 * Two analyzer paths are scored, because the app has two:
 *
 *   measurement   `analyzeBeatGridFromPcm` — log-band flux -> autocorrelation ->
 *                 lattice phase -> tempo refinement -> Ellis DP -> beat map. This
 *                 is the fallback that runs when the Essentia kernel cannot load,
 *                 and it is the path the CI gate covers.
 *   primary       `analyzeBeatGrid` — Essentia's RhythmExtractor2013 with the
 *                 onset-autocorrelation cross-check, falling back to the
 *                 measurement path. This is what a browser normally runs. The
 *                 Essentia WASM kernel does load under Node, so this path is
 *                 scored here too rather than being described from documentation;
 *                 each row reports which path answered.
 *
 * Two corpora:
 *
 *   default        the deterministic synthetic corpus (scripts/lib/beat-corpus.mjs).
 *                  Click-accurate, no downloads, runs in CI, gates regressions.
 *   --corpus DIR   annotated audio (WAV + .beats). This is the only mode that can
 *                  support an accuracy claim; see bench/README.md for the layout
 *                  and for where to get Ballroom / SMC / Harmonix.
 *
 * Other analyzers are scored the same way, through the same metrics:
 *
 *   --trackers DIR reads `<DIR>/<tracker>/<track>.beats` — the cache that
 *                  bench/trackers/run_trackers.py writes for Beat This!, librosa
 *                  and anything else that emits beat times. Each one is turned
 *                  into the grid a DJ would get and scored exactly like ours, so
 *                  "which tracker is more accurate here" is one table.
 *                  Requires --corpus; external trackers are never gated.
 *
 * Usage:
 *   node scripts/bench-beats.mjs [--corpus DIR] [--trackers DIR] [--paths pcm,primary]
 *                               [--only substr] [--json out.json] [--tolerance 0.07]
 *                               [--no-gate] [--quiet] [--emit DIR]
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { syntheticCorpus } from './lib/beat-corpus.mjs'
import { readWav, writeWav, parseBeatAnnotation, pairCorpusFiles } from './lib/beat-annotation.mjs'
import {
  listTrackers,
  loadTrackerBeats,
  loadTrackerTimings,
  parseTrackerBeats,
  gridFromTrackedBeats,
} from './lib/tracker-beats.mjs'
import { analyzeBeatGrid, analyzeBeatGridFromPcm } from '../src/lib/dj/beatgrid.ts'
import { pcmFromChannels } from '../src/lib/dj/pcm.ts'
import {
  BEAT_TOLERANCE_SECONDS,
  beatFMeasure,
  continuity,
  downbeatReport,
  dropReport,
  formatDrift,
  gridBeatsAcross,
  gridDrift,
  referenceTempo,
} from '../src/lib/dj/beat-metrics.ts'

/**
 * Regression floors for the **measurement** path, not accuracy claims.
 *
 * They are measured on the synthetic corpus with a margin, and their only job is
 * to fail the build when a change makes the grid worse. Raising them without a
 * measurement in the commit message would turn the gate into a lie; lowering them
 * to make a change pass is exactly the kind of weakened check this exists to
 * prevent.
 *
 * Current readings (9 synthetic tracks, click-accurate annotations): measurement
 * path mean F 0.992, median CMLt 1.000, mean |error| 6 ms, worst per-track drift
 * trend 115 ms/min (the accelerating track's own trend — a constant-grid number
 * cannot express a real tempo change, which is why this is the loosest gate and
 * the mean-error gate is the one that catches a grid sliding out from under a
 * mix). The primary path reads 0.992 / 1.000 / 7 ms on the same corpus.
 *
 * Both paths are gated, because both are ours to keep working and the primary one
 * is the path the app actually runs. The primary floors are looser (0.95 rather
 * than 0.97): its front end is a WASM kernel whose ticks we do not control, while
 * its decision layer — the octave committee, the phase anchor, the map guards — is
 * exactly ours. Scoring that path is what exposed the decision-layer defects it
 * had (see ./README.md), so leaving it ungated would leave the door open for them
 * to come back unnoticed.
 */
const GATES = {
  meanF: 0.97,
  medianCmlt: 0.97,
  maxMeanAbsSeconds: 0.02,
  maxDriftSecondsPerMinute: 0.15,
  meanDownbeatMatch: 0.97,
}

const PRIMARY_GATES = {
  meanF: 0.95,
  medianCmlt: 0.95,
  maxMeanAbsSeconds: 0.04,
  maxDriftSecondsPerMinute: 0.15,
  meanDownbeatMatch: 0.95,
}

const PATHS = {
  pcm: {
    label: 'measurement path (analyzeBeatGridFromPcm)',
    gated: true,
    score: (source, track) => Promise.resolve(analyzeBeatGridFromPcm(source, track.hintBpm)),
  },
  primary: {
    label: 'primary path (analyzeBeatGrid: Essentia RhythmExtractor2013, falling back to measurement)',
    gated: true,
    score: (source, track) => analyzeBeatGrid(source, track.hintBpm),
  },
}

function parseArgs(argv) {
  const args = {
    corpus: null,
    trackers: null,
    only: null,
    json: null,
    emit: null,
    tolerance: BEAT_TOLERANCE_SECONDS,
    paths: ['pcm', 'primary'],
    gate: true,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--corpus') args.corpus = argv[++i]
    else if (arg === '--trackers') args.trackers = argv[++i]
    else if (arg === '--emit') args.emit = argv[++i]
    else if (arg === '--only') args.only = argv[++i]
    else if (arg === '--json') args.json = argv[++i]
    else if (arg === '--tolerance') args.tolerance = Number(argv[++i])
    else if (arg === '--paths') args.paths = String(argv[++i]).split(',').map(value => value.trim())
    else if (arg === '--no-gate') args.gate = false
    else if (arg === '--quiet') args.quiet = true
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^#![^\n]*\n\/\*\*/, ''))
      process.exit(0)
    } else if (arg.startsWith('--')) {
      console.error(`unknown flag ${arg}`)
      process.exit(2)
    }
  }
  const unknown = args.paths.filter(path => !PATHS[path])
  if (unknown.length > 0) {
    console.error(`unknown path(s) ${unknown.join(', ')}; known: ${Object.keys(PATHS).join(', ')}`)
    process.exit(2)
  }
  if (args.trackers && !args.corpus) {
    console.error('--trackers reads a cache keyed by corpus audio files; it needs --corpus DIR')
    process.exit(2)
  }
  return args
}

/**
 * The paths to score: ours from {@link PATHS}, plus one per external tracker.
 *
 * An external tracker has no analyzer to call — its cache already holds the beat
 * times — so its `score` only converts those times into the same `BeatGrid` ours
 * produces. Everything downstream (F-measure, continuity, drift, the bar report)
 * is then literally the same code, which is the entire point of putting them in
 * one table.
 */
function pathsFor(args) {
  const paths = {}
  for (const name of args.paths) paths[name] = PATHS[name]
  if (args.trackers) {
    const trackers = listTrackers(args.trackers)
    if (trackers.length === 0) {
      console.error(
        `no tracker output under ${args.trackers} (expected <tracker>/<track>.beats; run bench/trackers/run_trackers.py first)`
      )
      process.exit(2)
    }
    for (const tracker of trackers) {
      if (PATHS[tracker]) {
        console.error(`tracker directory "${tracker}" collides with a built-in path name; rename it`)
        process.exit(2)
      }
      paths[tracker] = {
        label: `${tracker} (external .beats)`,
        gated: false,
        external: tracker,
        timings: loadTrackerTimings(args.trackers, tracker),
        score: (source, track) => {
          const tracked = loadTrackerBeats(args.trackers, tracker, track.name)
          if (!tracked) return null
          return gridFromTrackedBeats(tracked, track.mono.length / track.sampleRate)
        },
      }
    }
  }
  return paths
}

/** Recursive file listing, relative to `root`. */
function listFiles(root) {
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const relative = prefix ? `${prefix}/${entry}` : entry
      const info = statSync(full)
      if (info.isDirectory()) walk(full, relative)
      else out.push(relative)
    }
  }
  walk(root, '')
  return out
}

/** Mono downmix of a decoded file. */
function monoOf(channels, length) {
  if (channels.length === 1) return channels[0]
  const mono = new Float32Array(length)
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length
  }
  return mono
}

function realCorpus(root) {
  const { pairs, missing } = pairCorpusFiles(listFiles(root))
  if (missing.length > 0) {
    console.warn(`warning: ${missing.length} audio file(s) have no annotation: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}`)
  }
  const withBars = pairs.filter(pair => pair.downbeats).length
  if (withBars > 0 && withBars < pairs.length) {
    console.warn(`note: ${withBars}/${pairs.length} track(s) have a downbeat annotation; bar columns cover those`)
  }
  return pairs.map(({ base, audio, annotation, downbeats }) => {
    const wav = readWav(new Uint8Array(readFileSync(join(root, audio))))
    const annotationText = readFileSync(join(root, annotation), 'utf8')
    const beats = parseBeatAnnotation(annotationText)
    // A `.beats` file that numbers each beat in its bar *is* a bar annotation:
    // GTZAN, Ballroom and the Beat This! annotation set all ship `time<TAB>number`
    // with `1` on the downbeat. Reading only the first column would throw that
    // away and leave the bar unscored on exactly the corpora worth scoring it on,
    // so the downbeats are derived from the same file when there is no separate
    // `.downbeats` file. A one-column annotation has no bar and stays absent.
    let barFromBeatNumbers
    if (!downbeats) {
      const tracked = parseTrackerBeats(annotationText)
      if (tracked.positions) {
        barFromBeatNumbers = tracked.beats.filter((_, index) => tracked.positions[index] === 1)
      }
    }
    return {
      name: base,
      sampleRate: wav.sampleRate,
      mono: monoOf(wav.channels, wav.length),
      beats,
      // Optional: scored when present, absent rather than invented when not.
      downbeats: downbeats
        ? parseBeatAnnotation(readFileSync(join(root, downbeats), 'utf8'))
        : barFromBeatNumbers && barFromBeatNumbers.length > 1
          ? barFromBeatNumbers
          : undefined,
      notes: basename(annotation),
    }
  })
}

/**
 * Which analyzer answered. The primary path's grid carries `bpmSource` from the
 * Essentia engine when it produced the tempo, and `onset-acf` when it fell
 * through — that difference is the whole reason both paths are scored.
 */
function answeredBy(grid) {
  const source = grid.analysis?.bpmSource ?? ''
  return source.startsWith('essentia') ? 'essentia' : 'measurement'
}

async function scoreTrack(track, tolerance, path) {
  const source = pcmFromChannels([track.mono], track.sampleRate)
  const started = performance.now()
  const grid = await path.score(source, track)
  const elapsedMs = Math.round(performance.now() - started)
  if (!grid) {
    return {
      name: track.name,
      failed: path.external ? `no beats for this track in the ${path.external} cache` : 'analyzer returned no grid',
      annotations: track.beats.length,
      elapsedMs,
    }
  }
  const estimated = gridBeatsAcross(grid, track.beats)
  const f = beatFMeasure(track.beats, estimated, tolerance)
  const cont = continuity(track.beats, estimated, tolerance)
  const drift = gridDrift(grid, track.beats)
  // Multiplier from the stored tempo to the annotated tempo: `2` means the grid
  // sits an octave low (a 87 BPM reading of a 174 BPM track), `0.5` an octave
  // high. Reported because an octave error is the failure mode a plain F-measure
  // hides: half the beats still land, so F stays middling and looks like noise.
  const ratio = grid.bpm > 0 ? referenceTempo(track.beats) / grid.bpm : 1
  const octave = Math.abs(ratio - 2) < 0.05 ? 2 : Math.abs(ratio - 0.5) < 0.05 ? 0.5 : 1
  return {
    name: track.name,
    notes: track.notes,
    answeredBy: path.external ?? answeredBy(grid),
    external: path.external ?? null,
    annotations: track.beats.length,
    gridBeats: estimated.length,
    f: f.f,
    precision: f.precision,
    recall: f.recall,
    cmlt: cont.cmlt,
    amlt: cont.amlt,
    bpm: grid.bpm,
    referenceBpm: referenceTempo(track.beats),
    octave,
    variable: drift.variableGrid,
    drift,
    // Bar-level scoring. `downbeat` is null when the corpus carries no bar
    // annotation (real corpora without a downbeat file) and when the tracker has
    // no bar model at all (an external tracker writing one column); the drop
    // report is always produced, because "the analyzer invented a drop" is
    // checkable everywhere.
    downbeat:
      (grid.barModel !== false) && Array.isArray(track.downbeats) && track.downbeats.length > 0
        ? downbeatReport(grid, track.downbeats, tolerance)
        : null,
    drop: dropReport(grid, Array.isArray(track.drops) ? track.drops : [], tolerance, Array.isArray(track.drops)),
    rotationDecidable: Boolean(track.rotationDecidable),
    truthRotation: typeof track.rotation === 'number' ? track.rotation : null,
    elapsedMs,
  }
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function aggregate(results) {
  const scored = results.filter(r => !r.failed)
  return {
    tracks: results.length,
    failed: results.filter(r => r.failed).length,
    meanF: scored.length > 0 ? scored.reduce((a, r) => a + r.f, 0) / scored.length : 0,
    medianCmlt: median(scored.map(r => r.cmlt)),
    medianAmlt: median(scored.map(r => r.amlt)),
    meanAbsSeconds: scored.length > 0 ? scored.reduce((a, r) => a + r.drift.meanAbsSeconds, 0) / scored.length : 0,
    worstDriftSecondsPerMinute: scored.reduce((a, r) => Math.max(a, Math.abs(r.drift.driftSecondsPerMinute)), 0),
    variableGrids: scored.filter(r => r.variable).length,
    octaveErrors: scored.filter(r => r.octave !== 1).length,
    answeredByEssentia: scored.filter(r => r.answeredBy === 'essentia').length,
    // Averaged over the tracks that were actually scored for the bar: a corpus
    // with no bar annotation, or a tracker with no bar output, must not read as a
    // perfect bar — that would make absence look like accuracy.
    meanDownbeatMatch: (() => {
      const barScored = scored.filter(r => r.downbeat)
      return barScored.length > 0
        ? barScored.reduce((a, r) => a + r.downbeat.matchRate, 0) / barScored.length
        : 0
    })(),
    barScoredTracks: scored.filter(r => r.downbeat).length,
    // A whole-beat bar error: every beat in place, every bar line on the wrong
    // beat. Counted separately from the match rate because it is the failure a
    // DJ hears and a match rate alone hides.
    rotationErrors: scored.filter(r => r.downbeat && r.downbeat.offsetBeats !== 0).length,
    wrongClaims: scored.filter(r => r.downbeat && r.downbeat.decided && r.downbeat.offsetBeats !== 0).length,
    missedDecisions: scored.filter(r => r.rotationDecidable && !(r.downbeat && r.downbeat.decided)).length,
    dropsMissing: scored.reduce((a, r) => a + r.drop.missing, 0),
    dropsExtra: scored.reduce((a, r) => a + r.drop.extra, 0),
    totalMs: Math.round(scored.reduce((a, r) => a + r.elapsedMs, 0)),
    results,
  }
}

/** `0`/`+1`/`dec`/`amb`/`1/1` — the bar and section state, in one column. */
function formatBar(result) {
  if (!result.downbeat) return result.drop.detected > 0 ? `— /${result.drop.extra}x` : '—'
  const offset = result.downbeat.offsetBeats === 0 ? '0' : `${result.downbeat.offsetBeats > 0 ? '+' : ''}${result.downbeat.offsetBeats}`
  // An external tracker that emits a bar number is *claiming* that bar, so `dec`
  // is the honest reading; the `ext` marker is there so a reader can tell a model's
  // claim from our analyzer's measured one at a glance.
  const claim = result.external ? 'ext' : result.downbeat.decided ? 'dec' : 'amb'
  const wrong = result.downbeat.offsetBeats !== 0 && (result.external || result.downbeat.decided) ? '!' : ''
  return `${offset}${wrong} ${claim}  ${result.drop.matched}/${result.drop.matched + result.drop.missing}${
    result.drop.extra > 0 ? `+${result.drop.extra}` : ''
  }`
}

function printSection(path, summary) {
  console.log(`\n[${path.label}]${path.gated ? '  — gated' : '  — reported, not gated'}`)
  console.log('track                          F      P      R     CMLt   AMLt   tempo        grid    answered-by   bar(offset claim drops)  drift')
  for (const r of summary.results) {
    if (r.failed) {
      console.log(`${r.name.padEnd(28)} FAILED: ${r.failed}`)
      continue
    }
    const tempo = `${r.bpm.toFixed(1)}/${r.referenceBpm.toFixed(1)}${r.octave === 1 ? ' ' : ` x${r.octave}`}`
    console.log(
      [
        r.name.padEnd(28),
        r.f.toFixed(3).padStart(5),
        r.precision.toFixed(3).padStart(6),
        r.recall.toFixed(3).padStart(6),
        r.cmlt.toFixed(3).padStart(6),
        r.amlt.toFixed(3).padStart(6),
        tempo.padEnd(12),
        (r.variable ? 'map' : 'const').padEnd(6),
        (r.answeredBy === 'essentia' ? 'essentia' : r.external ? r.external : 'measurement').padEnd(11),
        formatBar(r).padEnd(22),
        formatDrift(r.drift),
      ].join('  ')
    )
  }
  console.log(
    `aggregate: mean F ${summary.meanF.toFixed(3)}   median CMLt ${summary.medianCmlt.toFixed(3)}` +
      `   median AMLt ${summary.medianAmlt.toFixed(3)}` +
      `   mean |err| ${(summary.meanAbsSeconds * 1000).toFixed(0)}ms` +
      `   worst |drift| ${(summary.worstDriftSecondsPerMinute * 1000).toFixed(0)}ms/min` +
      `   variable grids ${summary.variableGrids}/${summary.tracks}` +
      `   octave errors ${summary.octaveErrors}` +
      `   downbeats ${summary.meanDownbeatMatch.toFixed(3)}` +
      `   bar errors ${summary.rotationErrors} (wrong claims ${summary.wrongClaims}, missed ${summary.missedDecisions})` +
      `   drops ${summary.dropsMissing} missed / ${summary.dropsExtra} extra` +
      `   ${summary.totalMs}ms total`
  )
  if (summary.barScoredTracks === 0) {
    console.log('   bar: not scored (no downbeat annotation, or this tracker emits no bar model)')
  }
  if (path.timings) {
    console.log(
      `   inference: ${path.timings.seconds.toFixed(1)}s over ${path.timings.tracks} track(s)` +
        ' (from the tracker runner; the ms above is only reading its cache)'
    )
  }
}

/**
 * Write the synthetic corpus as WAV + annotations so an external tracker can run
 * on the one corpus this repository can ship.
 *
 * Without it, `--trackers` has nothing to read unless a real annotated corpus has
 * been downloaded, and the wiring between the two halves of the benchmark would
 * be untested until someone did. The audio is synthesised, so this adds no data
 * to the repository: it is regenerated on demand.
 */
function emitSyntheticCorpus(corpus, dir) {
  mkdirSync(dir, { recursive: true })
  for (const track of corpus) {
    writeFileSync(join(dir, `${track.name}.wav`), writeWav([track.mono], track.sampleRate))
    writeFileSync(join(dir, `${track.name}.beats`), track.beats.map(time => `${time.toFixed(6)}\n`).join(''))
    if (Array.isArray(track.downbeats) && track.downbeats.length > 0) {
      writeFileSync(
        join(dir, `${track.name}.downbeats`),
        track.downbeats.map(time => `${time.toFixed(6)}\n`).join('')
      )
    }
  }
  console.log(`wrote ${corpus.length} synthetic track(s) to ${dir}`)
}

const args = parseArgs(process.argv.slice(2))
const tolerance = args.tolerance
const corpus = args.corpus ? realCorpus(args.corpus) : syntheticCorpus()
if (args.emit) {
  if (args.corpus) {
    console.error('--emit writes the synthetic corpus; it cannot be combined with --corpus')
    process.exit(2)
  }
  emitSyntheticCorpus(corpus, args.emit)
  process.exit(0)
}
let tracks = corpus
if (args.only) tracks = tracks.filter(track => track.name.includes(args.only))
tracks = tracks.filter(track => track.beats.length >= 8)
if (tracks.length === 0) {
  console.error('no scoreable tracks in the corpus')
  process.exit(2)
}

const paths = pathsFor(args)

const label = args.corpus
  ? `real corpus ${args.corpus}`
  : 'synthetic corpus (click-accurate annotations, regression gate only — not an accuracy claim)'
if (!args.quiet) {
  console.log(`\nKeyBPM beat-grid benchmark — ${label}`)
  console.log(
    `tolerance: ${(tolerance * 1000).toFixed(0)} ms    tracks: ${tracks.length}    paths: ${Object.keys(paths).join(', ')}`
  )
}

const summaries = {}
for (const path of Object.keys(paths)) {
  const results = []
  for (const track of tracks) results.push(await scoreTrack(track, tolerance, paths[path]))
  summaries[path] = aggregate(results)
  if (!args.quiet) printSection(paths[path], summaries[path])
}

const summary = {
  corpus: args.corpus ?? 'synthetic',
  tolerance,
  tracks: tracks.length,
  paths: Object.fromEntries(
    Object.entries(summaries).map(([path, value]) => [
      path,
      { ...value, label: paths[path].label, gated: paths[path].gated },
    ])
  ),
  gates: { pcm: GATES, primary: PRIMARY_GATES },
}

if (args.json) {
  mkdirSync(dirname(args.json), { recursive: true })
  writeFileSync(args.json, `${JSON.stringify(summary, null, 2)}\n`)
  if (!args.quiet) console.log(`\nwrote ${args.json}`)
}

if (args.gate && !args.corpus) {
  const failures = []
  const gatedPaths = [
    ['pcm', GATES],
    ['primary', PRIMARY_GATES],
  ]
  for (const [path, gates] of gatedPaths) {
    if (!args.paths.includes(path)) {
      failures.push(`the gated ${path} path was not run (use --paths pcm,primary)`)
      continue
    }
    const gated = summaries[path]
    if (gated.meanF < gates.meanF) failures.push(`${path}: mean F ${gated.meanF.toFixed(3)} < ${gates.meanF}`)
    if (gated.medianCmlt < gates.medianCmlt) {
      failures.push(`${path}: median CMLt ${gated.medianCmlt.toFixed(3)} < ${gates.medianCmlt}`)
    }
    if (gated.meanAbsSeconds > gates.maxMeanAbsSeconds) {
      failures.push(
        `${path}: mean |err| ${(gated.meanAbsSeconds * 1000).toFixed(0)}ms > ${gates.maxMeanAbsSeconds * 1000}ms`
      )
    }
    if (gated.worstDriftSecondsPerMinute > gates.maxDriftSecondsPerMinute) {
      failures.push(
        `${path}: worst |drift| ${(gated.worstDriftSecondsPerMinute * 1000).toFixed(0)}ms/min > ${gates.maxDriftSecondsPerMinute * 1000}ms/min`
      )
    }
    if (gated.failed > 0) failures.push(`${path}: ${gated.failed} track(s) produced no grid`)
    if (gated.octaveErrors > 0) failures.push(`${path}: ${gated.octaveErrors} track(s) landed on the wrong octave`)
    if (gated.meanDownbeatMatch < gates.meanDownbeatMatch) {
      failures.push(
        `${path}: downbeat match ${gated.meanDownbeatMatch.toFixed(3)} < ${gates.meanDownbeatMatch}`
      )
    }
    // The bar gates are the point of scoring downbeats at all: a whole-beat bar
    // error is invisible to the beat metrics and wrecks a mix, and a rotation the
    // analyzer claims has to be right — a wrong claim is worse than no claim,
    // because the DJ has no reason to check it.
    if (gated.rotationErrors > 0) {
      failures.push(`${path}: ${gated.rotationErrors} track(s) have bar lines a whole beat out`)
    }
    if (gated.wrongClaims > 0) {
      failures.push(`${path}: ${gated.wrongClaims} track(s) claim a bar rotation they get wrong`)
    }
    if (gated.missedDecisions > 0) {
      failures.push(
        `${path}: ${gated.missedDecisions} track(s) left a decidable bar rotation undecided`
      )
    }
    if (gated.dropsMissing > 0) failures.push(`${path}: ${gated.dropsMissing} annotated drop(s) not found`)
    if (gated.dropsExtra > 0) failures.push(`${path}: ${gated.dropsExtra} drop(s) reported where none happens`)
  }
  if (failures.length > 0) {
    console.error(`\nbenchmark gate failed:\n  - ${failures.join('\n  - ')}\n`)
    process.exit(1)
  }
  if (!args.quiet) console.log('\nbenchmark gate passed (measurement + primary paths)')
}

process.exit(0)
