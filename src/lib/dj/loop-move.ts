import type { LoopRegion } from './types'

/** Where an armed loop and the playhead sit after MOVE has jumped them. */
export interface LoopTravel {
  /** Start of the loop after the jump. */
  start: number
  /** End of the loop after the jump. The loop keeps the length it was armed with. */
  end: number
  /**
   * Where the playhead lands: the same offset inside the loop it had before, so the part
   * of the phrase being heard is still the part being heard.
   */
  playhead: number
}

/**
 * Where a loop and the playhead land when MOVE jumps `delta` seconds.
 *
 * MOVE is a playhead jump, but a loop that is already running is the thing the jump is
 * for: `seek` would release it the moment the playhead landed outside it (which is right
 * for a scrub or a hot cue — jumping out of a loop means leaving it), so MOVE relocates
 * the loop by the distance the playhead actually travels instead.
 *
 * Both move by the same amount, which is what keeps the playhead's *offset* inside the
 * loop intact. Snapping the loop's start onto the playhead would instead drop the part of
 * the loop before the playhead and knock the window off the beat, because a running loop's
 * playhead is almost never on a beat when the button is pressed.
 *
 * The travel is clamped, not refused, at both ends of the track: the loop lands as far as
 * it can go and the playhead rides along the same distance. Null means there is nothing
 * that can travel — no loop, a degenerate one, or one already pressed against the end it
 * was asked to move towards.
 *
 * @param loop - The armed loop, or null.
 * @param playhead - Current playhead, which is inside the loop whenever one is armed.
 * @param delta - Seconds to jump, positive forward.
 * @param duration - Track length in seconds; the loop may not run past it.
 */
export function travelLoop(
  loop: LoopRegion | null | undefined,
  playhead: number,
  delta: number,
  duration: number
): LoopTravel | null {
  if (!loop) return null
  const length = loop.end - loop.start
  if (!(length > 0) || length > duration) return null

  const start = Math.min(Math.max(loop.start + delta, 0), duration - length)
  if (start === loop.start) return null

  const shift = start - loop.start
  return {
    start,
    end: start + length,
    playhead: Math.min(Math.max(playhead + shift, 0), duration),
  }
}
