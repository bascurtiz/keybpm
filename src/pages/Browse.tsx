import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FilterBar, PLAIN_MODE, hasActiveFilters } from '@/components/FilterBar'
import { bpmInRange } from '@/lib/bpm'
import type { FilterState } from '@/components/FilterBar'
import { TrackTable, compareTracks } from '@/components/TrackTable'
import type { SortKey, SortDir } from '@/components/TrackTable'
import { EmptyState } from '@/components/EmptyState'
import { tracks, bpmBounds, useCatalog } from '@/lib/data'
import { searchTracks } from '@/lib/search'
import { downloadCsv, downloadJson } from '@/lib/export'
import { formatCount } from '@/lib/format'
import { useMediaQuery } from '@/lib/useMediaQuery'

/** Filter fields whose non-null value means "this filter is doing something". */
const FACET_KEYS = ['bpmMin', 'bpmMax', 'key', 'camelot', 'mode', 'genre', 'label', 'yearMin', 'yearMax'] as const

const VALID_SORTS: SortKey[] = ['artist', 'title', 'bpm', 'key', 'camelot', 'sources', 'genre', 'label', 'year']

/** Read filter + sort state from the URL — every view is shareable (§27). */
function readState(params: URLSearchParams): FilterState & { sort: SortKey; dir: SortDir; q: string } {
  const num = (k: string) => {
    const v = params.get(k)
    if (v === null || v === '' || Number.isNaN(Number(v))) return null
    return Number(v)
  }
  const str = (k: string) => params.get(k) || null
  const sortParam = str('sort')
  const sort: SortKey = sortParam && VALID_SORTS.includes(sortParam as SortKey)
    ? (sortParam as SortKey)
    : 'artist'
  const dir: SortDir = str('dir') === 'desc' ? 'desc' : 'asc'

  return {
    q: str('q') ?? '',
    bpmMin: num('bpmMin') ?? (num('bpmMax') !== null ? bpmBounds.min : null),
    bpmMax: num('bpmMax') ?? (num('bpmMin') !== null ? bpmBounds.max : null),
    key: str('key'),
    camelot: str('camelot'),
    mode: str('mode'),
    genre: str('genre'),
    label: str('label'),
    yearMin: num('yearMin'),
    yearMax: num('yearMax'),
    sort,
    dir,
  }
}

function writeState(s: FilterState & { sort: SortKey; dir: SortDir; q: string }): URLSearchParams {
  const p = new URLSearchParams()
  if (s.q) p.set('q', s.q)
  if (s.bpmMin !== null) p.set('bpmMin', String(s.bpmMin))
  if (s.bpmMax !== null) p.set('bpmMax', String(s.bpmMax))
  if (s.key) p.set('key', s.key)
  if (s.camelot) p.set('camelot', s.camelot)
  if (s.mode) p.set('mode', s.mode)
  if (s.genre) p.set('genre', s.genre)
  if (s.label) p.set('label', s.label)
  if (s.yearMin !== null) p.set('yearMin', String(s.yearMin))
  if (s.yearMax !== null) p.set('yearMax', String(s.yearMax))
  if (s.sort !== 'artist') p.set('sort', s.sort)
  if (s.dir !== 'asc') p.set('dir', s.dir)
  return p
}

export function Browse() {
  const [params, setParams] = useSearchParams()
  // Re-compute results when the catalog changes (approved-queue overlay).
  const catalogVersion = useCatalog()
  const state = useMemo(() => readState(params), [params])

  // Below lg the facet panel is a disclosure — on a 360px phone it would
  // otherwise push the track list a full screen down.
  const isLg = useMediaQuery('(min-width: 1024px)')
  const [filtersOpen, setFiltersOpen] = useState(false)
  useEffect(() => {
    if (isLg) setFiltersOpen(false)
  }, [isLg])

  const activeFilterCount = FACET_KEYS.filter(k => state[k] !== null).length

  // Keep header search box in sync: it writes ?q= here directly.
  const set = (patch: Partial<FilterState & { sort: SortKey; dir: SortDir; q: string }>) => {
    setParams(writeState({ ...state, ...patch }))
  }

  const results = useMemo(() => {
    // 1. Music-aware text search
    let rows = searchTracks(tracks, state.q)

    // 2. Facet filters
    rows = rows.filter(t => {
      if (!bpmInRange(t, state.bpmMin, state.bpmMax)) return false
      if (state.key && t.key !== state.key) return false
      if (state.camelot && t.camelot !== state.camelot) return false
      if (state.mode && (state.mode === PLAIN_MODE ? !!t.mode : t.mode !== state.mode)) return false
      if (state.genre && t.genre !== state.genre) return false
      if (state.label && t.label !== state.label) return false
      if (state.yearMin !== null && (t.year === null || t.year < state.yearMin)) return false
      if (state.yearMax !== null && (t.year === null || t.year > state.yearMax)) return false
      return true
    })

    // 3. Sort (nulls last)
    rows.sort((a, b) => compareTracks(a, b, state.sort, state.dir))
    return rows
  }, [state, catalogVersion])

  useEffect(() => {
    document.title = state.q
      ? `${state.q} — KeyBPM Search`
      : 'Browse Tracks — KeyBPM'
  }, [state.q])

  function toggleSort(key: SortKey) {
    if (state.sort === key) {
      set({ dir: state.dir === 'asc' ? 'desc' : 'asc' })
    } else {
      set({ sort: key, dir: 'asc' })
    }
  }

  const filtersActive = hasActiveFilters(state) || state.q !== ''

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Browse</h1>
        <p className="font-mono text-sm tabular-nums">
          {formatCount(results.length)}
          <span className="text-text-dim"> / {formatCount(tracks.length)} tracks</span>
        </p>
      </div>

      {/* minmax(0,1fr) so a long unbreakable track title can never widen the grid. */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[280px_1fr] lg:gap-6">
        <aside
          id="browse-filters"
          className={`${filtersOpen ? 'block' : 'hidden'} lg:sticky lg:top-20 lg:block lg:self-start`}
        >
          <FilterBar
            filters={state}
            onChange={patch => set(patch)}
            onClear={() => setParams(new URLSearchParams())}
            hasQuery={state.q !== ''}
          />
        </aside>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={() => setFiltersOpen(o => !o)}
              aria-expanded={filtersOpen}
              aria-controls="browse-filters"
              className="btn-ghost px-3 py-1.5 text-xs lg:hidden"
            >
              Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
              <span aria-hidden className={`transition-transform duration-150 ${filtersOpen ? 'rotate-180' : ''}`}>
                ▾
              </span>
            </button>
            <p className="order-last w-full text-xs text-text-muted lg:order-none lg:w-auto lg:flex-1">
              {filtersActive ? (
                <>Filtered by <span className="font-mono text-text">{state.q || 'facets'}</span></>
              ) : (
                'Click a column header to sort — click a row for details.'
              )}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden font-mono text-2xs tabular-nums text-text-dim sm:inline">
                Export {formatCount(results.length)}
              </span>
              <button
                type="button"
                onClick={() => downloadCsv(results, 'KeyBPM-export.csv')}
                disabled={results.length === 0}
                className="btn-ghost px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => downloadJson(results, 'KeyBPM-export.json')}
                disabled={results.length === 0}
                className="btn-ghost px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                JSON
              </button>
            </div>
          </div>

          {results.length === 0 ? (
            <EmptyState
              title="No tracks match"
              hint="Try widening the BPM range, clearing a facet, or searching a different term."
              action={
                <button
                  type="button"
                  onClick={() => setParams(new URLSearchParams())}
                  className="btn-ghost text-xs"
                >
                  Clear all filters
                </button>
              }
            />
          ) : (
            <TrackTable
              tracks={results}
              sort={state.sort}
              dir={state.dir}
              onSort={toggleSort}
              caption="Tracks matching current filters"
            />
          )}
        </section>
      </div>
    </div>
  )
}
