/**
 * The console's on state, in one place.
 *
 * Every switch on the instrument that can be *on* — SLIP, cue pads, SYNC, TAP, LOOP, MOVE,
 * ECHO, RVRB, SNAP, QUANT, FX assign, the deck's KEY, the play/cue pair — used to spell its
 * own version of the same idea. Most were `bg-[#141414] text-white` with a 1 px white border
 * and a soft white glow, but the framed cells that share a border with their neighbour could
 * only white the edge they owned (`border-b-white`, `border-x-white`), some cells had no
 * outline at all and lit up with the glow alone, the FX drawer used `shadow-sm`, the FX chip
 * used a 6 px glow, and the loop-length readout went `#101010` / `#dcdcdc` instead of the
 * standard surface and white type. Twenty-odd near-misses read as several families of
 * control rather than one instrument.
 *
 * The recipe is a *recessed* key, not a lit one: the surface drops to the console's darkest
 * step (`#101010`, one level below the #141414 a control rests on) and the label goes white.
 * No outline, no glow. A ring around every active switch turned the console into a grid of
 * white boxes that competed with the music data in the lane above, and it made two lit
 * neighbours (LOOP over MOVE) draw a double line at the seam. Dropping the surface instead
 * reads as a key that has travelled down, which is what a physical console does.
 *
 * The border stays the frame's own grey rather than going transparent or white: a cell inside
 * a shared frame must keep its 1 px so the label cannot move when the state flips, and the
 * grey is what the dividers between stacked cells (SYNC over TAP) are made of — at white
 * they were the loudest lines on the row, and at transparent the cells merged into one block.
 *
 * Colour is reserved for meaning, never for decoration — and it belongs to the *label*, not the
 * panel. Three families share one surface, the recessed `#101010` above, and differ only in the
 * colour their label lights up with: `ACTIVE` keeps white for the keys that actuate something
 * directly — the hot cue pads, the play key, the nudge pair, the crossfade arrows; `ACTIVE_KEY`
 * lights warm for the two controls that prepare a track (the deck's KEY and the transport's CUE);
 * `ACTIVE_SWITCH` lights green for the switches that change how the deck *behaves* — SYNC, TAP,
 * SLIP, LOOP, MOVE, the FX block, AUTO. A glance can still tell *what* is running, not just
 * *where*, but a lit key costs one word of colour instead of a coloured rectangle.
 *
 * SLIP moved into the green family after the transports settled: it is the same kind of control
 * as LOOP and MOVE — a mode you arm, which then changes what the keys beside it do — and it sits
 * directly above CUES in the column whose bottom row is SYNC / TAP. Left white it read as one of
 * the pads rather than as a mode, and a console where one mode is white and three are green
 * makes the reader ask what the difference is.
 *
 * Filled coloured keys — solid first, then translucent — were tried and both were too loud. On a
 * console this dense the effect is a grid of tinted blocks competing with the music lane above
 * it and with the deck accents around it, and the eye reads the block before it reads the word.
 * The fill is therefore always neutral: the key travels down and the label comes up, which is
 * what a physical console does, and the hue is a property of the legend. The two lit colours are
 * deliberately desaturated pastels rather than signal green or amber, so they sit at the weight
 * of the rest of the row instead of shouting over it, and both keep well over 8:1 against the
 * recessed surface.
 *
 * Deck identity is the other colour axis: the beatgrid buttons that belong to a deck light up in
 * that deck's colour, and the loop-length readout uses the same legend green as `ACTIVE_SWITCH`.
 */
export const ACTIVE = 'bg-[#101010] text-white border-[#282828]'

/**
 * The warm on state: the deck's KEY and the transport's CUE.
 *
 * Both act on the track you have loaded rather than on the mix — one shifts its pitch, the other
 * is its start point — so they share a colour and it is not the performance green. It is a muted
 * sand rather than an amber: the two keys have to be findable without lighting up the corner of
 * the console, and a pastel reads as a lamp behind a printed legend rather than a painted key.
 *
 * Neutral fill, grey border, no glow — the same recessed key as `ACTIVE`; only the legend is warm.
 */
export const ACTIVE_KEY = 'bg-[#101010] text-[#d9a06a] border-[#282828]'

/**
 * The performance on state: SYNC, TAP, SLIP, LOOP, MOVE, ECHO, RVRB, the FX assign row and AUTO.
 *
 * A soft mint legend (`#7fc79b`) on the same recessed surface as everything else. The green is
 * light enough to read at 8.5 px on a near-black key and quiet enough that six of them can be
 * engaged at once without the row turning into a colour block.
 */
export const ACTIVE_SWITCH = 'bg-[#101010] text-[#7fc79b] border-[#282828]'

/**
 * Geometry lock for a control that sits inside a shared frame: 1 px of border on every
 * side, transparent until the control is on. Without it, the active state would change the
 * content box and nudge the label as the state flips.
 */
export const CELL = 'border border-transparent'

/**
 * The loop-length readout while a loop is running.
 *
 * Every other cell on the transport row names an action, so the standard surface underneath it
 * says nothing; this one *states a value*, and the value is the loop that is playing. The value
 * therefore changes colour rather than gaining a frame: the digits take the same legend green as
 * `ACTIVE_SWITCH`, so the count and the LOOP key beside it are one state seen twice.
 *
 * A frame is deliberately absent — the LOOP key next door already carries one while the loop
 * runs, so outlining the count as well made two lit rectangles describe one state, and the count
 * is not the thing you press to release it. The label carries the state here; the key carries
 * the control. The fill stays the transport row's own surface, so the number reads as printed on
 * the panel and only its ink changes. The surface is stated explicitly rather than inherited:
 * the cell sits inside the loop cluster's #141414 frame, and leaving the fill off the active
 * branch let that lighter frame show through, so the running count read as a raised block while
 * its own neighbours stayed dark. `#101010` is the same step the idle count uses, so engaging a
 * loop changes nothing but the digits.
 *
 * Console green rather than the deck accents' emerald — this is console state, not deck identity.
 * `CELL` still supplies a transparent border, so switching the state cannot move the label.
 */
export const ACTIVE_LOOP_COUNT = 'bg-[#101010] text-[#7fc79b]'

/** Deck A's accent, in the same outline-and-glow shape as `ACTIVE`. */
export const ACTIVE_DECK_A =
  'bg-[#141414] text-emerald-400 border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.25)]'

/** Deck B's accent, in the same outline-and-glow shape as `ACTIVE`. */
export const ACTIVE_DECK_B =
  'bg-[#141414] text-purple-400 border-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.25)]'
