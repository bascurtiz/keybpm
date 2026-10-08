import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

/**
 * Large search box for the homepage. Parses nothing itself — hands the raw
 * query to /browse where the music-aware parser runs on every keystroke.
 */
export function SearchBar() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [text, setText] = useState(params.get('q') ?? '')

  useEffect(() => {
    setText(params.get('q') ?? '')
  }, [params])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (text) p.set('q', text)
    navigate(`/browse?${p.toString()}`)
  }

  return (
    <form onSubmit={onSubmit} role="search" className="w-full max-w-2xl">
      <input
        type="search"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Search artist, title, BPM, key, Camelot…"
        aria-label="Search tracks"
        className="input w-full px-4 py-3.5 text-base"
      />
      <p className="mt-2 text-xs text-text-dim">
        Try <code className="font-mono text-accent">128 11A</code>,{' '}
        <code className="font-mono text-accent">F#m 125-130</code>, or{' '}
        <code className="font-mono text-accent">charli 8A</code>
      </p>
    </form>
  )
}
