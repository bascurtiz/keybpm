/**
 * Browser sniffing, confined to one function so it stays auditable.
 *
 * The DJ console leans on things browsers implement differently — AudioWorklet
 * scheduling, `decodeAudioData` on odd formats, `AudioBufferSourceNode` restarts,
 * the rubberband/keylock worklet — and Safari is the one engine where those paths
 * have not been made to behave. Saying so up front is more honest than letting a
 * deck go silent halfway through a mix.
 *
 * What counts as Safari: Safari itself, and the iPadOS build that reports a Mac
 * user agent. What does *not*: Chrome, Edge, Opera and Firefox, even though every
 * one of them carries `Safari/` in its user agent for compatibility — and even on
 * iOS, where they are all WebKit underneath but the user picked a browser whose
 * name we can honour. In-app webviews (Instagram, Facebook, …) are not Safari
 * either: they drop the `Version/` token, so they are left alone rather than
 * nagged on a page they cannot leave.
 *
 * Accepts the user agent as an argument so the rules can be tested without a
 * browser; the component calls it with no argument.
 */
export function isSafari(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  if (!ua) return false

  // Real Safari advertises its product version; Safari-compatible clones do not.
  if (!/Version\/[\d.]+/.test(ua) || !/Safari\//.test(ua)) return false

  // Each other browser keeps its own product token next to the Safari one.
  return !/(?:Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPiOS|Firefox|FxiOS)\//.test(ua)
}
