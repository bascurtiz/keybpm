/**
 * Size of a cue flag — the white stripe and its letter — on the mini waveform strip,
 * in the canvas's own drawing units.
 *
 * The strip is a canvas, so its drawing space is its *displayed* size: 22 px tall at
 * the console's design size, but ~15 px once the 1120 px chassis is scaled down to fit
 * a phone. A fixed 9 px label is 41% of that strip — the 'C' read as the largest thing
 * in the deck header, taller than the waveform it was labelling — and its baseline at a
 * fixed y clipped it against the top edge. Deriving both from the strip keeps the label
 * the same share of the strip everywhere: at 22 px this returns exactly the 9 px font
 * and 8 px baseline the strip always had, so desktop is unchanged.
 */

/** Strip canvas height at the console's design size (h-6 less its two 1 px borders). */
const DESIGN_H = 22
const DESIGN_FONT = 9
const DESIGN_BASELINE = 8
const DESIGN_STRIPE = 2

export interface CueFlag {
  /** Font size for the cue label. */
  font: number
  /** Text baseline, measured down from the top of the strip. */
  baseline: number
  /** Width of the full-height stripe. */
  stripe: number
}

export function cueFlag(stripHeight: number): CueFlag {
  if (!(stripHeight > 0)) return { font: 0, baseline: 0, stripe: 0 }
  const scale = Math.min(1, stripHeight / DESIGN_H)
  return {
    font: DESIGN_FONT * scale,
    baseline: DESIGN_BASELINE * scale,
    // Never below one pixel: a stripe that thins to nothing is a cue you cannot see,
    // and the canvas rounds sub-pixel fills to a hairline anyway.
    stripe: Math.max(1, DESIGN_STRIPE * scale),
  }
}
