import { useLayoutEffect, useState } from 'react'

/**
 * Width the DJ chassis is laid out at, in CSS px.
 *
 * Not a free number: the deck row's three columns have to fit inside it with the row's own
 * 14 px padding. The deck columns are 322 and the mixer 338 — the filter/FX panel is the one
 * section that was widened (to 136), so 322 + 14 + 338 + 14 + 322 + 28 padding + 2 of chassis
 * border = 1040. Change a column and this follows; leave it behind and the row overflows the
 * chassis, which `overflow-hidden` turns into a clipped edge control.
 */
export const CONSOLE_WIDTH = 1040

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
  designWidth = CONSOLE_WIDTH,
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
