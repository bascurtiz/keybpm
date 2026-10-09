import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { tracks, useCatalog } from '@/lib/data'
import { parseQuery, matchesTrack } from '@/lib/search'
import { formatBpm } from '@/lib/format'

const MAX_SUGGESTIONS = 8

/**
 * Large search box for the homepage. Parses nothing itself — hands the raw
 * query to /browse where the music-aware parser runs on every keystroke.
 *
 * As you type it also surfaces a live list of matching tracks (the same
 * music-aware matching that powers /browse), so a known artist/title/key/BPM
 * can be opened directly instead of going through the full results page.
 */
export function SearchBar() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Keep suggestions in sync when the catalog changes (approved overlay).
  const catalogVersion = useCatalog()
  const [text, setText] = useState(params.get('q') ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setText(params.get('q') ?? '')
  }, [params])

  // Top matches for the current query. Stops once we have enough, so typing
  // stays instant even against the full dataset.
  const suggestions = useMemo(() => {
    const q = text.trim()
    if (!q) return []
    const parsed = parseQuery(q)
    const words = parsed.text ? parsed.text.toLowerCase().split(/\s+/) : []
    const out = []
    for (const t of tracks) {
      if (matchesTrack(t, parsed, words)) {
        out.push(t)
        if (out.length >= MAX_SUGGESTIONS) break
      }
    }
    return out
  }, [text, catalogVersion])

  // Close when clicking/tapping outside the search box.
  useEffect(() => {
    function onDocPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointer)
    return () => document.removeEventListener('mousedown', onDocPointer)
  }, [])

  const showList = open && suggestions.length > 0

  function goToBrowse(query: string) {
    const p = new URLSearchParams()
    if (query) p.set('q', query)
    navigate(`/browse?${p.toString()}`)
  }

  function openTrack(id: string) {
    setOpen(false)
    navigate(`/track/${id}`)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (active >= 0 && suggestions[active]) {
      openTrack(suggestions[active].id)
      return
    }
    setOpen(false)
    goToBrowse(text)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
      return
    }
    if (!showList) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => (i + 1 >= suggestions.length ? 0 : i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => (i - 1 < 0 ? suggestions.length - 1 : i - 1))
    }
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-2xl">
      <form onSubmit={onSubmit} role="search" className="w-full">
        <input
          type="search"
          value={text}
          onChange={e => {
            setText(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search artist, title, BPM, key, Camelot…"
          aria-label="Search tracks"
          role="combobox"
          aria-expanded={showList}
          aria-controls="home-search-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `home-search-option-${active}` : undefined}
          className="input w-full px-4 py-3.5 text-base"
        />
      </form>

      <p className="mt-2 text-xs text-text-dim">
        Try <code className="font-mono text-accent">128 11A</code>,{' '}
        <code className="font-mono text-accent">F#m 125-130</code>, or{' '}
        <code className="font-mono text-accent">daft punk 8A</code>
      </p>

      {showList && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-line bg-bg-card shadow-xl">
          <ul id="home-search-suggestions" role="listbox" aria-label="Track suggestions" className="max-h-80 overflow-y-auto">
            {suggestions.map((t, i) => (
              <li key={t.id} role="option" id={`home-search-option-${i}`} aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => openTrack(t.id)}
                  className={`flex w-full items-baseline justify-between gap-2 px-4 py-2.5 text-left transition-colors ${
                    i === active ? 'bg-bg-hover' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t.artist}</span>
                    <span className="block truncate text-xs text-text-muted">{t.title}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-text-dim">
                    {formatBpm(t.bpm)} · {t.camelot ?? '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              goToBrowse(text)
            }}
            className="block w-full border-t border-line px-4 py-2 text-left text-xs text-accent hover:bg-bg-hover"
          >
            View all results for “{text.trim()}” →
          </button>
        </div>
      )}
    </div>
  )
}
