/**
 * External tracker output for the beat benchmark.
 *
 * The benchmark has always scored our own analyzer by reading the **stored grid**
 * back through the deck's accessors. To put another analyzer next to it — Beat
 * This!, librosa, anything that writes beat times — the same thing has to happen:
 * its output has to become the grid a DJ would get, and then the same metrics run
 * over it. This module is that bridge, and it is deliberately the only place that
 * knows an outside tracker exists.
 *
 * Format: the MIR-standard `.beats` file, which is what Beat This! writes and
 * what the annotated corpora ship — one line per beat, `time` then a beat number
 * where `1` is the downbeat (`12.345\t1`). A tracker with no bar model (librosa)
 * writes one column and the bar columns are simply not scored for it, rather than
 * being guessed at.
 *
 * Nothing here runs the trackers. `bench/trackers/run_trackers.py` does that and
 * writes `<out>/<tracker>/<track>.beats`; this reads the cache.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Beat times, and the bar positions when the file carries them.
 *
 * `positions` is `null` when no line had a second column: a tracker that has no
 * concept of a bar should not be scored on one, and inventing positions would
 * turn "this model cannot do downbeats" into a measured defect of the bar.
 */
export function parseTrackerBeats(text) {
  const beats = []
  const positions = []
  let withPositions = 0
  let twoColumn = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const fields = line.split(/[\s,;]+/)
    const time = Number(fields[0])
    if (!Number.isFinite(time) || time < 0) continue
    beats.push(time)
    if (fields.length > 1) {
      const position = Number(fields[1])
      if (Number.isFinite(position) && position >= 1) {
        positions.push(Math.round(position))
        withPositions++
      } else {
        positions.push(null)
      }
    } else {
      positions.push(null)
    }
    twoColumn++
  }

  // Sort the two columns together: a tracker that writes beats out of order (a
  // chunked model stitching across a boundary is the realistic case) would
  // otherwise pair a time with another beat's position.
  const order = beats.map((_, index) => index).sort((a, b) => beats[a] - beats[b])
  const sortedBeats = order.map(index => beats[index])
  const hasPositions = twoColumn > 0 && withPositions === twoColumn
  const sortedPositions = hasPositions ? order.map(index => positions[index]) : null
  const beatsPerBar = sortedPositions && sortedPositions.length > 0 ? Math.max(...sortedPositions) : 0
  return {
    beats: sortedBeats,
    positions: sortedPositions,
    // Only a plausible bar length is adopted; a tracker that numbers beats 1..N
    // through the track has no bar model and falls back to 4, which is what the
    // deck assumes too. It is reported, not hidden — see bench/README.md.
    beatsPerBar: beatsPerBar >= 2 && beatsPerBar <= 12 ? beatsPerBar : 0,
  }
}

/**
 * Inference seconds per track, from the runner's `timings.json`.
 *
 * Speed is part of choosing an analyzer — the app tracks live in a browser, so a
 * model that is a few points better but twenty times slower is a different
 * decision. Returns `null` when the cache has no timings.
 */
export function loadTrackerTimings(root, tracker) {
  try {
    const timings = JSON.parse(readFileSync(join(root, tracker, 'timings.json'), 'utf8'))
    const seconds = Object.values(timings).filter(value => typeof value === 'number')
    if (seconds.length === 0) return null
    return { tracks: seconds.length, seconds: seconds.reduce((a, b) => a + b, 0) }
  } catch {
    return null
  }
}

/** Tracker names cached under `root` — one directory per tracker. */
export function listTrackers(root) {
  let entries
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  return entries
    .filter(name => {
      try {
        return statSync(join(root, name)).isDirectory()
      } catch {
        return false
      }
    })
    .filter(name => {
      try {
        return readdirSync(join(root, name)).some(file => file.endsWith('.beats'))
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * The tracker's beat file for one corpus track, or `null` when it never ran.
 *
 * Looked up by basename because the corpus deals in basenames: `pairCorpusFiles`
 * keys every track by the audio file's stem, and the runner writes that same stem.
 */
export function loadTrackerBeats(root, tracker, name) {
  const path = join(root, tracker, `${name}.beats`)
  try {
    return parseTrackerBeats(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * The grid a DJ would get if this tracker's beats were the analyzer.
 *
 * The beats are stored verbatim as a variable-tempo map rather than fitted to a
 * constant lattice. That is not a convenience: it is the only representation that
 * scores the tracker on what it actually predicted. Fitting a single tempo would
 * hide exactly the failure this benchmark exists to find — a tracker that follows
 * a drifting track and one that does not would read the same.
 *
 * `firstBar` is the first predicted downbeat (or the first beat, for a tracker
 * with no bar model), so `downbeatReport` scores the bar phase the model claims.
 *
 * `barModel` is `false` for a tracker that writes one column — librosa does. The
 * benchmark then reports "no bar output" instead of scoring a bar the model never
 * claimed: a grid whose first beat merely happens to be treated as a downbeat
 * would turn "this tracker cannot do downbeats" into a measured phase error.
 */
export function gridFromTrackedBeats(tracked, duration) {
  const beats = []
  for (const time of tracked.beats) {
    if (!Number.isFinite(time) || time < -0.05 || time > duration + 0.5) continue
    if (beats.length > 0 && time - beats[beats.length - 1] < 0.02) continue
    beats.push(time)
  }
  if (beats.length < 2) return null

  const intervals = []
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1])
  intervals.sort((a, b) => a - b)
  const median = intervals[Math.floor(intervals.length / 2)]
  const bpm = median > 0 ? 60 / median : 0
  if (!(bpm > 0)) return null

  // The first predicted downbeat, snapped onto the nearest stored beat so the bar
  // anchor is a beat the grid actually has.
  let firstBar = beats[0]
  if (tracked.positions) {
    const downbeat = tracked.beats[tracked.positions.indexOf(1)]
    if (Number.isFinite(downbeat)) {
      const beatLen = 60 / bpm
      for (const time of beats) {
        if (Math.abs(time - downbeat) < Math.abs(firstBar - downbeat)) firstBar = time
        if (time - downbeat > beatLen) break
      }
    }
  }

  return {
    bpm,
    firstBeat: beats[0],
    firstBar,
    beatsPerBar: tracked.beatsPerBar || 4,
    beats,
    barModel: Boolean(tracked.positions),
  }
}
