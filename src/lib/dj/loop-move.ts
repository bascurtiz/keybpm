// `.ts` on the specifier so `scripts/test-loop-move.mjs` can import this module in plain node, the way
// the other tested dj modules do.
import { barIndexAt, barTimeAt } from './grid.ts'
import type { BeatGrid, LoopRegion } from './types'

/**
 * Comparison slack for "is this bar line at or past the reach", in seconds. A bar line that lands
 * exactly on the reach is one loop length away, which is allowed, so the test has to be against a
 * tolerance rather than a strict `>=` — the grid's beat times are floats.
 */
const BAR_EPSILON = 1e-6

/**
 * Where a loop lands when MOVE travels it one step in `direction`.
 *
 * The loop keeps its own length and lands on a **bar line**, always at least one loop length away in
 * the direction pressed. Two rules in one, and both matter:
 *
 * - Bar lines, because a loop that travels by its own size alone drifts off the phrase. A four-beat
 *   loop moves bar to bar, an eight-beat loop two bars at a time, and a two-beat or one-beat loop —
 *   which has no whole-bar step of its own length — moves a bar rather than a fraction of one.
 * - At least a length, because a loop need not be sitting on a bar line to begin with (SNAP off, or
 *   a loop dragged in from a grid edit). Snapping that loop to the *nearest* bar line would move it
 *   backwards while the forward arrow was pressed; taking the first line at or past the reach always
 *   moves it forwards, and the first press also squares it up onto the grid.
 *
 * On a variable-tempo grid the destination comes from the grid's own bar index and time, so it lands
 * where that track's bars actually are rather than where a fixed bar length would put them. The grid
 * is required rather than optional on purpose: a track that was never analysed has no grid, and
 * letting the lookup fall back to `grid.ts`'s 120 BPM default would snap a 174 BPM track's loops to
 * 120 BPM bar lines. The deck gives such a track a constant grid at its own tempo instead — see
 * `DeckEngine.loopMoveTarget`.
 *
 * @param loop - The armed loop, or null.
 * @param grid - The track's grid at its own tempo.
 * @param direction - -1 for the previous bar line, 1 for the next.
 * @param duration - Track length in seconds; a destination past the end is not offered.
 * @returns The destination window, or null when the loop cannot travel that way — before the first
 *   bar, or past the end of the track. Null is what a transport renders as a disabled arrow.
 */
export function loopMoveDestination(
  loop: LoopRegion | null | undefined,
  grid: BeatGrid,
  direction: -1 | 1,
  duration: number
): { start: number; end: number } | null {
  if (!loop) return null
  const length = loop.end - loop.start
  if (!(length > 0)) return null

  // One loop length, in the direction pressed: the nearest bar line the loop may land on.
  const reach = loop.start + direction * length

  const index = barIndexAt(grid, reach)
  let start = barTimeAt(grid, index)
  // Going forward the bar *containing* the reach sits behind it whenever the reach is not itself on a
  // bar line, so step onto the next one. Going back that bar is at or before the reach already, which
  // is one length or more away by construction — no step needed.
  if (direction > 0 && start < reach - BAR_EPSILON) start = barTimeAt(grid, index + 1)

  const end = start + length
  if (start < 0 || end > duration) return null
  return { start, end }
}
