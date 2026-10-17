import { useLayoutEffect, useState } from 'react'

/**
 * How the console is shown when it has to share a phone screen with a browser.
 *
 * - `fit`: the whole chassis, scaled down until it fits both axes. This is what a
 *   landscape phone shows — the complete console at a glance, in its own
 *   proportions instead of being cropped. It is small, which is why it is a toggle.
 * - `actual`: the chassis at its real size, scrolling on whichever axis runs out.
 *   A portrait phone then holds the console's full *height* and pans sideways, so
 *   each third of the console (deck A / mixer / deck B) is about one screen wide.
 */
export type ConsoleFit = 'fit' | 'actual'

/** Width the DJ chassis is laid out at, in CSS px (fixed by the hardware mock-up). */
export const CONSOLE_WIDTH = 1120

interface ConsoleFitResult {
  /** Attach to the element that defines the available space. */
  setBoxRef: (el: HTMLDivElement | null) => void
  /** Attach to the chassis itself. */
  setChassisRef: (el: HTMLDivElement | null) => void
  /** Scale for `fit` mode; 1 while measuring, and always 1 in `actual` mode. */
  scale: number
}

/**
 * Measures a fixed-width chassis against the space it was given.
 *
 * The console is a hardware mock-up: a 7-column mixer, two jog wheels and three
 * faders are laid out at fixed pixel sizes, and reflowing them for a 360 px phone
 * would shrink every control until nothing is tappable. So the console keeps its
 * geometry and the *viewport* adapts to it — this hook does the measuring, and the
 * caller applies the returned scale as a transform.
 *
 * `offsetWidth`/`offsetHeight` ignore transforms, so measuring a scaled chassis
 * cannot feed the scale back into itself: the observer fires once per real layout
 * change, never in a loop.
 *
 * Refs are held in state rather than refs so the observers are attached when the
 * elements actually exist: kiosk mode is a media query, so the nodes appear and
 * disappear on rotation and on a desktop window resize.
 */
export function useConsoleFit(mode: ConsoleFit, designWidth = CONSOLE_WIDTH): ConsoleFitResult {
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
  }, [boxEl, chassisEl, mode])

  const scale =
    mode === 'fit' && box.w > 0 && box.h > 0 && chassis.w > 0 && chassis.h > 0
      ? Math.min(1, box.w / chassis.w, box.h / chassis.h)
      : 1

  return { setBoxRef: setBoxEl, setChassisRef: setChassisEl, scale }
}
