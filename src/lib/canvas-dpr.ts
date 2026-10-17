/**
 * Backing-store scale for a canvas that is redrawn on every animation frame.
 *
 * `devicePixelRatio` is 3 on most phones, so a 740 CSS px wide waveform lane asks for
 * 2,220 device columns — nine times the pixels of a 1x canvas. That matters here more
 * than it does on a static image, because these lanes are repainted sixty times a
 * second while the audio thread is sharing the same SoC, and the DJ console they live
 * in is drawn inside a chassis that is scaled *down* to fit a landscape phone: at a
 * typical fit of 0.6 the display only resolves 1.8 of those 3 device pixels anyway.
 *
 * Capping at 2 keeps the waveform oversampled after that fit (so it still looks
 * sharp), while cutting the pixels the fill has to touch by more than half. It is
 * also the ceiling Chrome itself uses for canvas backing stores on many Android
 * devices, so nothing above 2 was ever guaranteed to be rendered.
 */
export const MAX_CANVAS_DPR = 2

export function canvasPixelRatio(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return Math.min(dpr, MAX_CANVAS_DPR)
}
