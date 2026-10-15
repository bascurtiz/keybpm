/**
 * Timeline capture for the offline mix renderer.
 *
 * Recording a mix is not recording audio: it is writing down what the decks did
 * — where each one read from, how fast, how it was EQ'd and faded — so the same
 * performance can be rebuilt later at a higher quality than realtime playback
 * could afford. That is the whole reason to replace a realtime MediaRecorder
 * with a renderer: a live capture bakes in the realtime keylock's automatic
 * windows and Opus at whatever the browser chose, while a rendered mix can pick
 * its own stretching windows and land in uncompressed PCM.
 *
 * Positions come from the audio clock, so the audible speed of a deck is
 * *measured* (`delta position / delta time`) rather than read off the pitch
 * fader. That makes nudges, PLL sync correction and scratches fall out of the
 * data for free instead of needing to be modelled.
 */
import type { AudioEngine } from './audio-engine'
import type { DeckId, Track } from './types'

/** Bumped when the shape of a stored timeline changes meaningfully. */
export const MIX_TIMELINE_VERSION = 1

/** One second of deck position, speed and settings, as captured. */
export interface RawDeckSample {
  /** Timeline seconds since the start of the recording. */
  t: number
  /** Source position in seconds, quantised to the audio render quantum. */
  position: number
  playing: boolean
  /**
   * Declared speed: pitch fader rate including nudge. Exact and noise-free,
   * unlike a speed derived from the quantised position signal.
   */
  rate: number
  keyLock: boolean
  /** Semitone shift from the key knob. */
  keyShift: number
  /** Index into the deck's track list, or -1 when the deck is empty. */
  trackIndex: number
}

/** A track as the renderer needs it: decoded audio plus its identity. */
export interface MixTrackRef {
  trackId: string
  title: string
  artist: string
  buffer: AudioBuffer
  sampleRate: number
  /** Per-track normalisation gain the live graph applies ahead of the fader. */
  gain: number
}

/**
 * One uninterrupted stretch of a deck reading at a single speed. Segment
 * boundaries are where a seek, a speed change or a load happened, because those
 * are the only moments a stretched stream cannot cross without a discontinuity.
 */
export interface RenderSegment {
  /** Timeline seconds where this segment starts. */
  start: number
  /** Source seconds to read from. */
  sourceStart: number
  /** Timeline seconds this segment covers. */
  duration: number
  /** Source seconds consumed per timeline second. */
  speed: number
  keyLock: boolean
  keyShift: number
  /** Index into the deck's track list. */
  trackIndex: number
}

export interface DeckControlPoint {
  t: number
  /** Channel fader (trim), 0..1. */
  gain: number
  /** Shelving/peaking EQ gains in dB. */
  eqLow: number
  eqMid: number
  eqHigh: number
  /** Filter knob, -1..1 (negative low-pass, positive high-pass). */
  filter: number
}

export interface MasterControlPoint {
  t: number
  crossfade: number
  volume: number
}

export interface DeckTimeline {
  tracks: MixTrackRef[]
  segments: RenderSegment[]
  controls: DeckControlPoint[]
}

export interface MixTimeline {
  version: number
  createdAt: string
  /** Capture period in seconds. */
  period: number
  /** Sample rate the decks were running at; the render matches it. */
  sampleRate: number
  duration: number
  decks: Record<DeckId, DeckTimeline>
  master: MasterControlPoint[]
}

/** Both decks, in a fixed order so renders and tests are deterministic. */
export const DECK_IDS: readonly DeckId[] = ['A', 'B']

/**
 * A speed change below this is left inside the current segment, so a slow pitch
 * move only splits where it has drifted this far from the segment's rate.
 */
export const SEGMENT_RATE_TOLERANCE = 0.002

/** Segments shorter than this are not worth their own stretcher pass. */
export const MIN_SEGMENT_SECONDS = 0.25

/** Position error beyond this (relative to the expected advance) is a seek. */
export const SEEK_TOLERANCE_SECONDS = 0.03

/**
 * Segment length at which the measured average speed is trusted over the
 * declared pitch-fader rate.
 *
 * Positions advance on the render quantum (~2.7 ms at 48 kHz), so a 20 ms
 * capture tick measures speed with percent-level noise: on a steady deck at
 * 1.05, consecutive tick measurements spread from 0.80 to 1.39. The noise is
 * zero-mean, though, so total displacement over a long enough span recovers the
 * true rate to well under 0.1 %. Below this span the declared rate wins, because
 * the endpoint quantisation is simply too large a fraction of the span.
 */
export const MEASURED_SPEED_MIN_SECONDS = 1.5

/**
 * Turns sampled deck state into renderable segments.
 *
 * A segment opens when the deck starts, or when a seek, a load or a drift-past
 * -tolerance speed change happens, and closes at the sample where the next one
 * begins or playback stops.
 *
 * Two signals, deliberately. The *declared* rate (`rate * nudge`, the pitch
 * fader's own value) is exact and instantaneous, so it decides where segments
 * break: splitting on noisy position measurements would shatter a performance
 * that never moved a fader. Positions are ground truth for *where* the audio
 * read from, so they decide seeks and loads, and they refine a long segment's
 * final speed — which also folds in sync's drift correction, which is not
 * exposed as a number anywhere.
 */
export function buildSegments(
  samples: RawDeckSample[],
  options: { period?: number; endTime?: number } = {}
): RenderSegment[] {
  const period = options.period ?? 0.02
  const segments: RenderSegment[] = []
  let open: RenderSegment | null = null
  // First and last positions seen in the open segment, for the measured average.
  let spanStart: { t: number; position: number } | null = null
  let spanEnd: { t: number; position: number } | null = null
  // The sample right after a segment opens straddles the discontinuity, so its
  // position span is meaningless and must not seed the measured average.
  let skipNextSpan = false

  const openSegment = (sample: RawDeckSample): RenderSegment => ({
    start: sample.t,
    sourceStart: sample.position,
    duration: 0,
    speed: sample.rate,
    keyLock: sample.keyLock,
    keyShift: sample.keyShift,
    trackIndex: sample.trackIndex,
  })

  const close = (end: number) => {
    if (!open) return
    const duration = Math.max(0, end - open.start)
    if (duration > 0) {
      // A long segment's average comes from how far the audio actually moved.
      const spanSeconds = spanStart && spanEnd ? spanEnd.t - spanStart.t : 0
      if (spanStart && spanEnd && spanSeconds >= MEASURED_SPEED_MIN_SECONDS) {
        const measured = (spanEnd.position - spanStart.position) / spanSeconds
        if (measured > 0.05 && measured < 4) open.speed = measured
      }
      segments.push({ ...open, duration })
    }
    open = null
    spanStart = null
    spanEnd = null
  }

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const previous = i > 0 ? samples[i - 1] : null

    if (!sample.playing || sample.trackIndex < 0) {
      close(sample.t)
      continue
    }

    if (!open) {
      open = openSegment(sample)
      spanStart = { t: sample.t, position: sample.position }
      spanEnd = spanStart
      skipNextSpan = true
      continue
    }

    const prev = previous && previous.playing ? previous : null
    const dt = prev ? sample.t - prev.t : 0      // Discontinuities are decided on raw positions: a seek jump is a move of
      // the audio, not a speed, and it breaks the position continuity a
      // stretched stream depends on.
    const loaded = sample.trackIndex !== open.trackIndex
    const seeked =
      !loaded &&
      prev !== null &&
      dt > 0 &&
      Math.abs(sample.position - (prev.position + open.speed * dt)) > SEEK_TOLERANCE_SECONDS

    if (loaded || seeked) {
      close(sample.t)
      open = openSegment(sample)
      spanStart = { t: sample.t, position: sample.position }
      spanEnd = spanStart
      skipNextSpan = true
      continue
    }

    if (dt > 0 && !skipNextSpan) {
      spanEnd = { t: sample.t, position: sample.position }
    }
    skipNextSpan = false

    // Speed breaks come from the declared fader rate, which is noise-free: a
    // deck left alone stays in one segment no matter how much the position
    // signal wanders.
    if (
      Math.abs(sample.rate - open.speed) > SEGMENT_RATE_TOLERANCE &&
      sample.t - open.start >= MIN_SEGMENT_SECONDS
    ) {
      close(sample.t)
      open = openSegment(sample)
      spanStart = { t: sample.t, position: sample.position }
      spanEnd = spanStart
      skipNextSpan = true
      continue
    }

    // Key-lock and key-shift are audible switches, not continuous controls:
    // nudge (a semitone) and the keylock button each need their own segment.
    if (sample.keyShift !== open.keyShift || sample.keyLock !== open.keyLock) {
      if (sample.t - open.start >= MIN_SEGMENT_SECONDS) {
        close(sample.t)
        open = openSegment(sample)
        spanStart = { t: sample.t, position: sample.position }
        spanEnd = spanStart
        skipNextSpan = true
        continue
      }
      open.keyShift = sample.keyShift
      open.keyLock = sample.keyLock
    }
  }

  const last = samples[samples.length - 1]
  if (open && last && last.playing) {
    close(Math.max(open.start, (options.endTime ?? last.t + period)))
  }

  return segments
}

/**
 * Drops control points that repeat the previous value, so a static fader costs
 * two automation points instead of thousands.
 */
export function compressControls<T extends { t: number }>(
  points: T[],
  changed: (a: T, b: T) => boolean
): T[] {
  const out: T[] = []
  for (const point of points) {
    const previous = out[out.length - 1]
    if (!previous || changed(previous, point)) out.push(point)
  }
  const last = points[points.length - 1]
  if (last && out[out.length - 1] !== last) out.push(last)
  return out
}

/** Deck settings that are audible in the render, sampled per capture tick. */
export function deckControlDiffers(a: DeckControlPoint, b: DeckControlPoint): boolean {
  return (
    Math.abs(a.gain - b.gain) > 0.002 ||
    Math.abs(a.eqLow - b.eqLow) > 0.02 ||
    Math.abs(a.eqMid - b.eqMid) > 0.02 ||
    Math.abs(a.eqHigh - b.eqHigh) > 0.02 ||
    Math.abs(a.filter - b.filter) > 0.002
  )
}

export function masterControlDiffers(a: MasterControlPoint, b: MasterControlPoint): boolean {
  return Math.abs(a.crossfade - b.crossfade) > 0.002 || Math.abs(a.volume - b.volume) > 0.002
}

/**
 * Samples the live engine while the user performs, then hands the renderer a
 * timeline. Nothing here touches audio; the engine keeps playing.
 */
export class MixRecorder {
  private readonly samples: Record<DeckId, RawDeckSample[]> = { A: [], B: [] }
  private readonly controls: Record<DeckId, DeckControlPoint[]> = { A: [], B: [] }
  private readonly tracks: Record<DeckId, MixTrackRef[]> = { A: [], B: [] }
  private master: MasterControlPoint[] = []
  private timer: number | null = null
  private startedAt = 0
  private readonly engine: AudioEngine
  private readonly periodMs: number

  // Plain field assignment rather than constructor parameter properties, so the
  // module's pure parts stay loadable by Node's TypeScript stripping in tests.
  constructor(engine: AudioEngine, periodMs = 20) {
    this.engine = engine
    this.periodMs = periodMs
  }

  get recording(): boolean {
    return this.timer !== null
  }

  get elapsedSeconds(): number {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0
  }

  start(): void {
    if (this.recording) return
    this.samples.A = []
    this.samples.B = []
    this.controls.A = []
    this.controls.B = []
    this.tracks.A = []
    this.tracks.B = []
    this.master = []
    this.startedAt = performance.now()
    this.timer = window.setInterval(() => this.tick(), this.periodMs)
    this.tick()
  }

  /** Stops sampling and returns the captured performance. */
  stop(): MixTimeline | null {
    if (this.timer === null) return null
    window.clearInterval(this.timer)
    this.timer = null
    return this.timeline()
  }

  /** Current capture as a timeline, without stopping. */
  timeline(): MixTimeline {
    const period = this.periodMs / 1000
    const end = (performance.now() - this.startedAt) / 1000
    const decks = {} as Record<DeckId, DeckTimeline>
    for (const id of DECK_IDS) {
      const samples = this.samples[id]
      decks[id] = {
        tracks: this.tracks[id],
        segments: buildSegments(samples, { period, endTime: end }),
        controls: compressControls(this.controls[id], deckControlDiffers),
      }
    }
    return {
      version: MIX_TIMELINE_VERSION,
      createdAt: new Date().toISOString(),
      period,
      sampleRate: this.engine.ctx.sampleRate,
      duration: Math.max(end, ...DECK_IDS.map(id => lastSegmentEnd(decks[id]))),
      decks,
      master: this.master,
    }
  }

  private tick(): void {
    const t = (performance.now() - this.startedAt) / 1000
    for (const id of DECK_IDS) {
      const deck = this.engine.decks[id]
      const track = deck.track
      this.samples[id].push({
        t,
        position: deck.position,
        playing: deck.playing,
        // Audible speed as the engine computes it, minus sync's internal drift
        // correction, which the long-segment measurement folds back in.
        rate: deck.rate * deck.nudgeFactor,
        keyLock: deck.keyLock,
        keyShift: deck.keyShift,
        trackIndex: track ? this.refIndex(id, track) : -1,
      })
      this.controls[id].push({
        t,
        gain: deck.gain,
        eqLow: deck.eqLowGain,
        eqMid: deck.eqMidGain,
        eqHigh: deck.eqHighGain,
        filter: deck.filterValue,
      })
    }
    this.master.push({
      t,
      crossfade: this.engine.crossfade,
      volume: this.engine.masterVolume,
    })
  }

  private refIndex(id: DeckId, track: Track): number {
    const list = this.tracks[id]
    const at = list.findIndex(ref => ref.trackId === track.id)
    if (at >= 0) return at
    list.push({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      buffer: track.buffer,
      sampleRate: track.buffer.sampleRate,
      gain: track.gain || 1,
    })
    return list.length - 1
  }
}

function lastSegmentEnd(deck: DeckTimeline): number {
  let end = 0
  for (const segment of deck.segments) end = Math.max(end, segment.start + segment.duration)
  return end
}

/** True when the timeline would render silence. */
export function isTimelineEmpty(timeline: MixTimeline | null): boolean {
  if (!timeline) return true
  return (
    timeline.decks.A.segments.length === 0 &&
    timeline.decks.B.segments.length === 0
  )
}

