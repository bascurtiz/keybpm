/**
 * Size of the empty-deck letter badge, in the canvas's own drawing units.
 *
 * The lanes are drawn through `StackedWaveforms`, whose canvas lives inside the DJ
 * chassis: a 1120 px console scaled down by a transform to fit a phone. The canvas's
 * drawing units are the *displayed* CSS pixels (the loop sets the transform from the
 * measured size), so a constant badge does not shrink with the console — it keeps its
 * size in screen pixels while every row around it gets smaller. On a phone that leaves
 * a 36 px square inside a 52 px lane, the loudest thing on the waveform, even though
 * the same 36 px is modest on a desktop.
 *
 * So the design size (the artwork square's proportions) is applied *through the
 * chassis scale*, exactly like the DOM next to it, and only then capped by the lane it
 * actually sits in. `uiScale` is that scale — displayed width over layout width — so a
 * phone at 0.675 gets a 24 px badge where a desktop at 1 gets the original 36.
 *
 * The lane cap stays as the backstop for a band squeezed below its floor, and for the
 * degenerate case of a lane measured before its first layout.
 */

/** Badge box and letter at the console's design size. */
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

export function laneBadge(laneHeight: number, uiScale = 1): LaneBadge {
  if (!(laneHeight > 0) || !(uiScale > 0)) return { box: 0, font: 0, radius: 0, stroke: 0 }
  // Work in design units, where the numbers mean what the mock-up says they mean, and
  // convert back at the end: the cap is on the badge's *design* size, not on how many
  // screen pixels it happens to occupy.
  const designBox = Math.min(DESIGN_BOX, (laneHeight / uiScale) * LANE_FRACTION)
  const box = designBox * uiScale
  return {
    box,
    font: box * (DESIGN_FONT / DESIGN_BOX),
    radius: box / 12,
    stroke: (designBox >= 28 ? 1.5 : 1) * uiScale,
  }
}
