/**
 * The time axis a waveform lane is drawn on.
 *
 * Lanes are drawn in *playback* time, not in each track's own source time. The
 * distinction only shows up when the two decks run at different rates — which is
 * exactly the case a stacked view exists to serve: a synced pair has to show its beats
 * in the same place on both lanes.
 *
 * Worked example, taken from a reported screenshot. Deck A is at its own tempo, grid
 * 123.04 BPM, rate 1.000. Deck B is synced down to it from a 126.1 BPM grid, so it plays
 * at rate 0.976. Both decks therefore read the same 123.04 BPM, and both sound locked.
 *
 *   source bar length  A: 240 / 123.04 = 1.9506 s
 *   source bar length  B: 240 / 126.1  = 1.9033 s
 *
 * On a source-time axis those are 363.5 px and 355.2 px — measured off the screenshot,
 * and 8.3 px per bar apart. Nothing is wrong with the sync: the mismatch accumulates
 * away from the centre playhead purely because the axis is per-track, so the grids
 * visibly drift apart while sounding perfectly locked.
 *
 * A source span of Δs seconds occupies Δs / rate seconds of playback, so scaling the
 * axis by the rate makes both decks' bars 363.5 px and lines the grids up everywhere.
 * That is also the honest picture of what is playing: at rate r a deck consumes r
 * seconds of source per second of output, whether keylock is holding the key or not.
 */

export interface LaneTimebase {
  /** Source seconds per screen pixel for this lane. */
  secPerPx: number
  /** Source time at the lane's left edge. */
  tStart: number
}

/**
 * Source seconds per screen pixel for a deck running at `rate`.
 *
 * @param playbackSecPerPx - Playback seconds per pixel, i.e. `windowSeconds / canvasWidth`.
 * @param rate - The deck's playback rate. Non-positive values are treated as 1.
 */
export function laneSecPerPx(playbackSecPerPx: number, rate: number): number {
  return playbackSecPerPx * (rate > 0 ? rate : 1)
}

/**
 * Resolves the axis a lane is drawn on.
 *
 * @param pos - Deck position in source seconds. Lands at the lane's centre.
 * @param windowSeconds - Width of the lane in playback seconds.
 * @param playbackSecPerPx - Playback seconds per pixel, i.e. `windowSeconds / canvasWidth`.
 * @param rate - The deck's playback rate. Non-positive values are treated as 1.
 */
export function laneTimebase(
  pos: number,
  windowSeconds: number,
  playbackSecPerPx: number,
  rate: number,
): LaneTimebase {
  const safeRate = rate > 0 ? rate : 1
  return {
    secPerPx: laneSecPerPx(playbackSecPerPx, safeRate),
    tStart: pos - (windowSeconds / 2) * safeRate,
  }
}

/** Screen x for a source time on a lane's axis. */
export function laneX(sourceTime: number, tb: LaneTimebase): number {
  return (sourceTime - tb.tStart) / tb.secPerPx
}
