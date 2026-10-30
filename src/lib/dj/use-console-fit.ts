import { useLayoutEffect, useState } from 'react'

/**
 * Width the DJ chassis is laid out at on a desktop, in CSS px.
 *
 * Not a free number: the deck row's three columns have to fit inside it with the row's own
 * 14 px padding. Both deck columns are 362 and the mixer 384 — the filter/FX panel is 142 px,
 * and the deck jog has room on either side. So 362 + 24 + 384 + 24 + 362 + 28 padding + 2 of chassis border =
 * 1186 (+4 slack to 1190). Change a column and this follows; leave it behind and the row overflows the chassis,
 * which `overflow-hidden` turns into a clipped edge control.
 *
 * The console was drawn at 1040 until the deck row was widened by 150 px: at that width the
 * mixer's five columns and the two jogs were pressed together, and the small gap between a
 * deck's key column and the mixer read as one continuous block. A desktop window has the room
 * — the console is drawn at 1× and centred, so the extra width is real estate, not scale — and
 * every control stays the size it was designed at. Only the containers grew: the mixer's outer
 * columns and filter/FX panel, and the air on either side of each jog.
 */
export const CONSOLE_WIDTH = 1280

/**
 * Width the chassis is laid out at in kiosk (phone) mode, in CSS px.
 *
 * Deliberately *not* `CONSOLE_WIDTH`: kiosk draws the console edge to edge, sized for the phone
 * rather than for the desktop window, and it lays its deck row out with 2.5 px gaps and a much
 * narrower mixer panel (see the kiosk branches in `TraktorDeck` / `TraktorMixer`).
 *
 * 1116 is the width at which the console's proportions match a landscape phone's. A phone screen
 * is wider than the console is tall-relative-to-wide (a 900×412 window is ~2.2:1, the console at
 * 1040 × 582 is ~1.8:1), so the fit is limited by *height*: the console filled the screen top to
 * bottom and stopped at about 82 % of its width, leaving dark bands either side — width the phone
 * owned and the instrument could not reach. Widening the design, and the content with it (bigger
 * platters, wider mixer columns), converts that spare width into larger controls: the scale is
 * still set by the height, so nothing is drawn smaller to pay for it. A tablet in landscape is
 * limited by width instead and fills it either way.
 *
 * This width is the design of the phone console, so it is coupled to the kiosk layout: the deck
 * is 360 (64 pitch + 16 + 200 jog + 16 + 64 keys) and the mixer 402 (48 / 54 / 148 / 54 / 48
 * plus 32 of gaps, 16 of padding and 2 of border), which with the row's own 8 px gaps and 16 px
 * padding comes to the chassis' 1138 px content box. Change a kiosk column and this follows.
 */
export const KIOSK_CONSOLE_WIDTH = 1180

interface ConsoleFitResult {
  /** Attach to the element that defines the available space. */
  setBoxRef: (el: HTMLDivElement | null) => void
  /** Attach to the chassis itself. */
  setChassisRef: (el: HTMLDivElement | null) => void
  /** Last measured size of the box, in CSS px. Zero until the first measurement. */
  box: { w: number; h: number }
  /**
   * Last measured size of the chassis, in *design* px (transforms do not affect
   * `offsetWidth`/`offsetHeight`, so this is the unchanging layout size, not what is on
   * screen). Callers that place chrome against the chassis need the height too when the
   * chassis sizes itself from its rows rather than from a number they computed.
   */
  chassis: { w: number; h: number }
  /** Scale for the chassis; 1 while measuring, and clamped to `maxScale`. */
  scale: number
}

/**
 * Measures a fixed-width chassis against the space it was given and reports the
 * scale that makes the whole console fit both axes.
 *
 * The console is a hardware mock-up: a 7-column mixer, two jog wheels and three
 * faders are laid out at fixed pixel sizes, and reflowing them for a 360 px phone
 * would shrink every control until nothing is tappable. So the console keeps its
 * geometry and the *viewport* adapts to it — this hook does the measuring, and the
 * caller applies the returned scale as a transform. There is no "actual size, pan
 * around" mode: a console you have to scroll to reach the crossfader is a worse
 * instrument than a small one you can see whole, and fullscreen (`fullscreen.ts`)
 * buys back the space that mode was papering over.
 *
 * `offsetWidth`/`offsetHeight` ignore transforms, so measuring a scaled chassis
 * cannot feed the scale back into itself: the observer fires once per real layout
 * change, never in a loop.
 *
 * `maxScale` is the ceiling on the drawn size. The console is a fixed-width
 * instrument, so on a wide window filling the box means drawing it larger than it
 * was designed — which is the point of a console page, and how the layout mock-up
 * looks. The ceiling is there for the other end: an ultra-wide display would
 * otherwise blow the jogs and the mixer up to twice their size, and a console that
 * large stops reading as hardware.
 *
 * Refs are held in state rather than refs so the observers are attached when the
 * elements actually exist: the console is rendered by a route, so the nodes appear
 * on navigation and disappear again.
 */
export function useConsoleFit(
  designWidth: number = CONSOLE_WIDTH,
  maxScale = 1
): ConsoleFitResult {
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null)
  const [chassisEl, setChassisEl] = useState<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [chassis, setChassis] = useState({ w: designWidth, h: 0 })

  useLayoutEffect(() => {
    if (!boxEl || !chassisEl) return
    const measure = () => {
      // `clientWidth/Height` of the box, not the viewport: on a phone this is already
      // the space left after the browser's own chrome (dvh), so the fit stays honest.
      setBox({ w: boxEl.clientWidth, h: boxEl.clientHeight })
      setChassis({ w: chassisEl.offsetWidth, h: chassisEl.offsetHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(boxEl)
    ro.observe(chassisEl)
    // iOS settles the viewport a beat after the rotation.
    window.addEventListener('orientationchange', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', measure)
    }
  }, [boxEl, chassisEl])

  const scale =
    box.w > 0 && box.h > 0 && chassis.w > 0 && chassis.h > 0
      ? Math.min(maxScale, box.w / chassis.w, box.h / chassis.h)
      : 1

  return { setBoxRef: setBoxEl, setChassisRef: setChassisEl, box, chassis, scale }
}
