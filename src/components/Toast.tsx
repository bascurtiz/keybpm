import { useEffect, useState } from 'react'

/**
 * Prototype's #toast: fixed bottom-center accent banner that fades in/out.
 * `toast(message)` from anywhere dispatches a window event — no provider needed.
 */
const EVENT = 'keydb:toast'

export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }))
}

export function Toast() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let hide: number | undefined
    const onToast = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail)
      window.clearTimeout(hide)
      hide = window.setTimeout(() => setMessage(null), 1800)
    }
    window.addEventListener(EVENT, onToast)
    return () => {
      window.removeEventListener(EVENT, onToast)
      window.clearTimeout(hide)
    }
  }, [])

  return (
    <div
      id="toast"
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-accent-solid px-[18px] py-2.5 text-sm font-medium transition-all duration-200 ${
        message ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      {message}
    </div>
  )
}
