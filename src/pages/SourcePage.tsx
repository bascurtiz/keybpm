import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { CamelotBadge } from '@/components/badges'
import { EmptyState } from '@/components/EmptyState'
import { sourceMeta } from '@/lib/sources'
import { loadListing, listingIds, type SourceKeyRow, type SourceListing } from '@/lib/sourceKeys'
import { CAMELOT_TO_KEY } from '@/types/track'
import { formatCount, formatDate } from '@/lib/format'
import { usePageMeta } from '@/lib/meta'
import { useScrollMargin } from '@/lib/useScrollMargin'

/**
 * `/source/:camelotsound` — every key a single source states, as it lists them.
 *
 * The pages exist because the key databases behind the consensus engine are
 * otherwise only visible as two-letter chips: this is where a chip's claim can
 * be checked against the source's own full listing, and where the source's
 * canonical page and what it covers are stated up front.
 *
 * A chip deep-links here anchored on a track (`#<track-id>`), so the page opens
 * scrolled to that entry with the row highlighted — the listing is virtualized,
 * so the row is not in the DOM until the effect jumps to it.
 */

const ROW_H = 40

export function SourcePage() {
  const { id } = useParams()
  const { hash } = useLocation()
  const [listing, setListing] = useState<SourceListing | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [query, setQuery] = useState('')

  const meta = id ? sourceMeta(id) : null

  useEffect(() => {
    if (!id) {
      setState('missing')
      return
    }
    let alive = true
    setState('loading')
    void loadListing(id).then(next => {
      if (!alive) return
      setListing(next)
      setState(next ? 'ready' : 'missing')
    })
    return () => {
      alive = false
    }
  }, [id])

  usePageMeta(
    meta?.listing ? `${meta.name} keys — KeyBPM` : "Source — KeyBPM",
    meta?.description ?? "A key source's own listing, in this database.",
  )

  // Anchored track: the chip passes a dataset id, never the source's own
  // spelling, so this lookup is a direct match.
  const anchor = decodeURIComponent(hash.replace(/^#/, ''))

  const rows = useMemo<SourceKeyRow[]>(() => {
    const all = listing?.rows ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      ([artist, title, camelot]) =>
        artist.toLowerCase().includes(q) ||
        title.toLowerCase().includes(q) ||
        camelot.toLowerCase() === q,
    )
  }, [listing, query])

  const targetIndex = useMemo(
    () => (anchor ? rows.findIndex(row => row[3] === anchor) : -1),
    [anchor, rows],
  )

  // The list container must exist on the first render for the margin hook to
  // measure it, so it is rendered even while the listing loads.
  const listRef = useRef<HTMLUListElement>(null)
  const scrollMargin = useScrollMargin(listRef)
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_H,
    overscan: 12,
    scrollMargin,
  })

  // Jump straight to the row's own offset (rows sit at scrollMargin + i*ROW_H)
  // rather than asking the virtualizer to align: the target is a document
  // position, and it needs to clear the sticky header, not centre on screen.
  const scrolledTo = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!anchor || targetIndex < 0 || scrollMargin <= 0) return
    if (scrolledTo.current === anchor) return
    scrolledTo.current = anchor
    const top = scrollMargin + targetIndex * ROW_H - 160
    window.scrollTo({ top: Math.max(0, top) })
  }, [anchor, targetIndex, scrollMargin])

  if (!id || !meta || state === 'missing') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title={id ? 'Unknown source' : 'No source selected'}
          hint={
            id ? (
              <>
                <code className="font-mono">{id}</code> has no published key listing. Sources with one:{' '}
                {listingIds().join(', ')}.
              </>
            ) : (
              'Open a source chip from any track to see the keys that source states.'
            )
          }
          action={<Link to="/browse" className="btn-primary">Browse tracks</Link>}
        />
      </div>
    )
  }

  // Deliberately no spacer rows: every row is absolutely positioned and moved
  // by its own transform (the pattern MobileList uses). Mixing an in-flow
  // spacer with absolutely positioned rows doubles their offsets — the browser
  // resolves each row's static position *after* the spacer, and the transform
  // then adds the offset again.
  const items = virtualizer.getVirtualItems()

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 lg:px-8">
      <h1 className="flex items-center gap-3 text-lg font-semibold">
        <span
          aria-hidden
          className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded border px-1 font-mono text-xs font-bold"
          style={{ backgroundColor: `${meta.color}26`, borderColor: meta.color }}
        >
          {meta.code}
        </span>
        {meta.name} keys
      </h1>

      <p className="mt-2 max-w-3xl text-sm text-text-muted">{meta.description}</p>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-dim">
        <span>
          Source:{' '}
          {meta.url ? (
            <a
              href={meta.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              {meta.url}
            </a>
          ) : (
            'not linked'
          )}
        </span>
        {listing && (
          <>
            <span aria-hidden>·</span>
            <span>
              {formatCount(listing.rows.length)} entries listed, snapshot {formatDate(listing.generated)}
            </span>
          </>
        )}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="source-filter">
          Filter {meta.name} entries
        </label>
        <input
          id="source-filter"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by artist, title or Camelot…"
          className="input w-full max-w-sm text-sm"
        />
        <span className="font-mono text-xs tabular-nums text-text-dim">
          {state === 'loading' ? 'Loading…' : `${formatCount(rows.length)} shown`}
        </span>
      </div>

      {state === 'ready' && rows.length === 0 ? (
        <p className="surface mt-4 px-4 py-4 text-xs text-text-muted">
          No {meta.name} entry matches “{query.trim()}”.
        </p>
      ) : (
        <ul
          ref={listRef}
          className="surface relative mt-4 overflow-clip"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map(item => {
            const [artist, title, camelot, trackId] = rows[item.index]
            const isTarget = !!anchor && trackId === anchor
            return (
              <li
                key={item.index}
                id={trackId}
                style={{ height: ROW_H, transform: `translateY(${item.start - scrollMargin}px)` }}
                className={`absolute inset-x-0 flex items-center gap-3 border-b border-line/60 px-4 ${
                  isTarget ? 'bg-accent/10' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sm" title={`${artist} – ${title}`}>
                  <span className="font-medium">{artist}</span>
                  <span className="text-text-dim"> – </span>
                  <span className="text-text-muted">{title}</span>
                </span>
                <CamelotBadge code={camelot} />
                <span className="hidden w-24 shrink-0 font-mono text-xs text-text-muted sm:block">
                  {CAMELOT_TO_KEY[camelot] ?? ''}
                </span>
                {trackId ? (
                  <Link
                    to={`/track/${trackId}`}
                    className="shrink-0 text-xs text-accent transition-colors hover:text-accent-hover"
                  >
                    Track →
                  </Link>
                ) : (
                  <span aria-hidden className="w-14 shrink-0" />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!query && (
        <p className="mt-3 text-xs text-text-dim">
          Only entries whose track is in this database are listed. The keys are exactly as {meta.name}{' '}
          states them — this database's own key for a track can differ.
        </p>
      )}
    </div>
  )
}
