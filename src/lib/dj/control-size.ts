/**
 * The console's standard control box, in design px.
 *
 * One size for every square-ish switch on the instrument — SYNC, TAP, KEY, SLIP, the four
 * hot cue pads, LOOP, MOVE, AUTO, FADE and the mixer's ECHO/BRK/RVRB/SCR — so that the
 * console reads as one set of switches rather than six families that happen to be near
 * each other. They used to run 38, 48, 50, 52 and 62 px wide and 20, 21, 22 and 44 px
 * tall, which made an arbitrary control look like the important one.
 *
 * 52 is the width of the *button itself*: the box you see and press, whether it carries
 * its own border (SLIP, AUTO, FADE) or sits as a cell inside a shared frame (SYNC above
 * TAP, the cue pads, ECHO above BRK). That distinction is why the frame number exists:
 * a frame draws the 1 px border round its cells, so it is 2 px wider than the cells it
 * holds. Using `CONTROL_W` for a frame — which the transport and mixer did — made those
 * cells 50 px against SLIP's 52, a 2 px difference that reads as SLIP being the odd
 * button out.
 *
 * The deck's key/cue column is laid out at 64 px so its 54 px frames have a 1 px margin
 * to the column's own border; its 52 px faces are therefore exactly SLIP's.
 */
export const CONTROL_W = 52
export const CONTROL_H = 22

/** A frame around one or more cells: `CONTROL_W` plus the 1 px border on each side. */
export const CONTROL_FRAME_W = CONTROL_W + 2

/** Two cells stacked inside one frame, plus the frame's own top and bottom border. */
export const CONTROL_STACK_H = CONTROL_H * 2 + 2
