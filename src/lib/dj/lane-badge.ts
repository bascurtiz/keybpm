/**
 * Size of the empty-deck letter badge, in the canvas's own drawing units.
 *
 * The lanes are drawn through `StackedWaveforms`, whose canvas lives inside the DJ
 * chassis: a 1120 px console scaled down by a transform to fit a phone. The drawing
 * space is the canvas's *displayed* size, not its 1120-px layout size, so a fixed
 * 36 px badge is 36 real pixels while the DOM around it has been scaled to roughly
 * two thirds — and a phone holds two lanes in ~64 px, so the badge was taller than
 * the lane it sat in and bled across the divider. Its letter read as the biggest
 * thing on the waveform.
 *
 * Deriving it from the lane instead makes it track the chassis automatically: at the
 * console's design size a lane is 48 px and this returns the original 36 px badge,
 * and below that (every phone, and any window too narrow for the full console) it
 * shrinks with the lane and never leaves it.
 */

/** Badge box at the console's design lane height, and the letter inside it. */
const DESIGN_BOX = 36
const DESIGN_FONT = 15
/** Share of the lane height the badge may take, leaving a margin either side. */
const LANE_FRACTION = 0.75

export interface LaneBadge {
  /** Side of the rounded square, in canvas drawing units. */
  box: number
  /** Font size for the deck letter. */
  font: number
  /** Corner radius for the square. */
  radius: number
  /** Border width, thinned as the badge shrinks so it does not become a blob. */
  stroke: number
}

export function laneBadge(laneHeight: number): LaneBadge {
  if (!(laneHeight > 0)) return { box: 0, font: 0, radius: 0, stroke: 0 }
  const box = Math.min(DESIGN_BOX, laneHeight * LANE_FRACTION)
  return {
    box,
    font: box * (DESIGN_FONT / DESIGN_BOX),
    radius: box / 12,
    stroke: box >= 28 ? 1.5 : 1,
  }
}
