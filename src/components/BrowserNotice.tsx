import { useState } from 'react'
import { isSafari } from '@/lib/browser'

/** Dismissal is permanent: a warning that returns every visit is a nag, not a warning. */
const STORAGE_KEY = 'keydb-browser-notice'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Private mode or blocked storage: show the notice rather than fail on it.
    return false
  }
}

interface BrowserNoticeProps {
  className?: string
}

/**
 * "This browser is not supported" notice, shown only in Safari (see `isSafari`).
 *
 * Non-blocking on purpose. The database half of KeyBPM works fine in Safari, and a
 * modal over a page someone can still use is a worse answer than a line of text that
 * says which part will not work. It renders nothing in every supported browser, so
 * the console pays no layout cost there.
 */
export function BrowserNotice({ className = '' }: BrowserNoticeProps) {
  const [dismissed, setDismissed] = useState(readDismissed)

  if (dismissed || !isSafari()) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Not persisting just means it comes back next visit; nothing to report.
    }
  }

  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[11px] leading-snug text-warn ${className}`}
    >
      <span className="flex-1">
        Optimized for Firefox and Chrome-based browsers. Safari won&apos;t be supported.
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss browser notice"
        className="-mr-1 shrink-0 rounded px-1 leading-none text-warn/70 transition-colors hover:text-warn"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
