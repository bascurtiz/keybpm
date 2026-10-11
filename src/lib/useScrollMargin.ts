import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Document-relative top of `el`, kept current as content above it changes
 * height (filter bars, banners, an async section landing).
 *
 * Window-virtualized lists need it as `scrollMargin` so their absolute row
 * offsets line up with `window.scrollY`. Shared by the track table and the
 * source key listings — both virtualize against the window.
 */
export function useScrollMargin(ref: RefObject<HTMLElement>): number {
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setMargin(el.getBoundingClientRect().top + window.scrollY)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [ref])
  return margin
}
